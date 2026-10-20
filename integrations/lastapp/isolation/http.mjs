/** Backend HTTP adapters. Native Fetch only; no credentials or side effects at import. */
import { parseEvent, processOne } from './contract.mjs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OBJECT = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const RPC = new Set(['edv9_last_receive','edv9_last_claim','edv9_last_complete','edv9_last_fail','edv9_last_probe_begin','edv9_last_probe_finish']);
const DB_ERRORS = new Set(['location_not_approved','organization_mismatch','location_mismatch','invalid_event','invalid_tab_id','event_id_conflict','unsupported_or_invalid_event','invalid_tab']);
const encoder = new TextEncoder();
export function failure(code, extra = {}) { return Object.assign(new Error(code), { code, ...extra }); }
export function cleanToken(value) {
  if (typeof value !== 'string') return '';
  let result = value.trim();
  if ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith("'") && result.endsWith("'"))) result = result.slice(1,-1).trim();
  result = result.replace(/^Bearer[ \t]+/i, '');
  if (!result || /[\s\r\n]/.test(result)) return '';
  return result;
}
export async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2,'0')).join('');
}
export async function authorized(header, expected, allowRaw = false) {
  const secret = cleanToken(expected);
  if (!secret || typeof header !== 'string' || header.length > 8192) return false;
  const match = header.match(/^Bearer[ \t]+([^\s]+)$/i);
  const supplied = match ? match[1] : allowRaw && !/\s/.test(header) ? header : '';
  if (!supplied) return false;
  const a = await sha256(supplied), b = await sha256(secret);
  let diff = 0;
  for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function readJson(message, maximum) {
  const contentType = message.headers.get('content-type') || '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw failure('unsupported_media_type');
  const length = message.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length)>maximum)) throw failure('body_too_large');
  if (!message.body) throw failure('invalid_json');
  const reader = message.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size>maximum) { await reader.cancel(); throw failure('body_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { throw failure('invalid_json'); }
}
export function retryAfter(value, now = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return 0;
  const number = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value)-now)/1000);
  return Number.isFinite(number) ? Math.max(0,Math.min(86400,number)) : 0;
}
export function createLastReader({token, fetchImpl = fetch}) {
  const secret = cleanToken(token);
  if (!secret) throw failure('last_credential_missing');
  return { async getTab(tabId,locationId,{timeoutMs=12000}={}) {
    if (!UUID.test(tabId) || !UUID.test(locationId)) throw failure('invalid_tab');
    const timeout = Math.min(12000,Math.max(1,Number(timeoutMs)||12000));
    const signal = AbortSignal.timeout(timeout);
    try {
      const response = await fetchImpl('https://api.last.app/v2/tabs/'+tabId, {
        method:'GET', redirect:'error', signal,
        headers:{Authorization:'Bearer '+secret,LocationID:locationId,Accept:'application/json'}
      });
      if (!response.ok) {
        const code = response.status===401 || response.status===403 ? 'last_unauthorized'
          : response.status===404 ? 'last_not_found' : response.status===429 ? 'last_rate_limited'
          : response.status>=500 ? 'last_unavailable' : 'invalid_tab';
        await response.body?.cancel();
        throw failure(code,{retryAfterSeconds:retryAfter(response.headers.get('retry-after'))});
      }
      try { return await readJson(response,1000000); }
      catch (error) {
        if (signal.aborted) throw failure('last_timeout');
        throw failure('invalid_tab');
      }
    } catch(error) {
      if (signal.aborted || error?.name==='TimeoutError' || error?.name==='AbortError') throw failure('last_timeout');
      if (['last_unauthorized','last_not_found','last_rate_limited','last_unavailable','last_timeout','invalid_tab'].includes(error?.code)) throw error;
      throw failure('last_unavailable');
    }
  }};
}
export function createRpcStore({supabaseUrl,serviceKey,fetchImpl=fetch}) {
  if (typeof supabaseUrl !== 'string' || !/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(supabaseUrl)) throw failure('invalid_supabase_url');
  const key = cleanToken(serviceKey);
  if (!key) throw failure('backend_credential_missing');
  const origin = supabaseUrl.replace(/\/$/,'');
  const headers = {'Content-Type':'application/json',Accept:'application/json',apikey:key};
  // Modern secret keys belong on apikey; legacy service-role JWTs also use Bearer.
  if (!key.startsWith('sb_secret_')) headers.Authorization='Bearer '+key;
  async function rpc(name,args) {
    if (!RPC.has(name) || !OBJECT(args)) throw failure('invalid_rpc');
    try {
      const response=await fetchImpl(origin+'/rest/v1/rpc/'+name,{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers,body:JSON.stringify(args)
      });
      let data;
      try { data=await readJson(response,1100000); } catch { throw failure('storage_unavailable'); }
      if (!response.ok) {
        const code=OBJECT(data)&&DB_ERRORS.has(data.message)?data.message:'storage_unavailable';
        throw failure(code);
      }
      return data;
    } catch(error) {
      if (DB_ERRORS.has(error?.code) || error?.code==='storage_unavailable') throw error;
      throw failure('storage_unavailable');
    }
  }
  return {
    rpc,
    async receive(event) {
      const result=await rpc('edv9_last_receive',{p_location_id:event.location_id,p_organization_id:event.organization_id,p_payload:event.raw});
      if (!['received','duplicate'].includes(result)) throw failure('storage_unavailable');
      return result;
    },
    async claim(locationId) {
      const claim=await rpc('edv9_last_claim',{p_location_id:locationId});
      if (claim===null) return null;
      if (!OBJECT(claim) || claim.location_id!==locationId.toLowerCase() || !UUID.test(claim.tab_id)
        || !UUID.test(claim.lease_token) || typeof claim.event_id!=='string' || !claim.event_id) throw failure('storage_unavailable');
      return claim;
    },
    complete:(id,lease,tab)=>rpc('edv9_last_complete',{p_event_id:id,p_lease_token:lease,p_tab:tab}),
    fail:(id,lease,code,delay)=>rpc('edv9_last_fail',{p_event_id:id,p_lease_token:lease,p_error_code:code,p_retry_after_seconds:delay})
  };
}
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const empty=status=>new Response(null,{status,headers:{'Cache-Control':'no-store'}});
function inputStatus(error) {
  if (error?.code==='body_too_large') return 413;
  if (error?.code==='unsupported_media_type') return 415;
  return 400;
}
/** Authentication and durable reception precede any worker wake-up. No browser CORS. */
export function createGateway({store,last,webhookToken,workerToken,enabled=false,allowRawAuth=false,schedule}) {
  return async function handle(request) {
    const action=new URL(request.url).pathname.split('/').filter(Boolean).at(-1);
    if (action==='health' && request.method==='GET') return json(200,{module:'edv9-last',enabled,live_last_verified:false});
    if (!['webhook','run'].includes(action)) return empty(404);
    if (request.method!=='POST') return empty(405);
    const secret=action==='webhook'?webhookToken:workerToken;
    if (!cleanToken(secret)) return empty(503);
    if (!(await authorized(request.headers.get('authorization'),secret,action==='webhook'&&allowRawAuth))) return empty(401);
    if (!enabled) return empty(503);
    let body;
    try { body=await readJson(request,action==='webhook'?150000:2048); }
    catch(error) { return empty(inputStatus(error)); }
    if (action==='run') {
      if (!OBJECT(body) || typeof body.location_id!=='string' || !UUID.test(body.location_id)) return empty(400);
      try {
        const result=await processOne({store,last},body.location_id.toLowerCase());
        return json(200,{state:result.state,...(result.error_code?{error_code:result.error_code}:{})});
      } catch { return json(503,{error:'worker_unavailable'}); }
    }
    let event;
    try { event=parseEvent(body,{locationId:request.headers.get('locationid'),organizationId:request.headers.get('organizationid')}); }
    catch { return empty(400); }
    if (!event.supported) return new Response(null,{status:200,headers:{'Cache-Control':'no-store','X-EDV9-Disposition':'unsupported'}});
    try {
      const state=await store.receive(event);
      if (state==='received' && typeof schedule==='function') {
        try { schedule(processOne({store,last},event.location_id).then(()=>undefined).catch(()=>undefined)); } catch { /* durable inbox remains available to /run */ }
      }
      return empty(200);
    } catch(error) {
      if (['location_not_approved','organization_mismatch','location_mismatch'].includes(error?.code)) return empty(403);
      if (error?.code==='event_id_conflict') return empty(409);
      if (DB_ERRORS.has(error?.code)) return empty(400);
      return empty(503);
    }
  };
}
