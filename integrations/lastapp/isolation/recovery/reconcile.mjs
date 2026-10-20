// Staging recovery. The vendor list is discovery only; the existing queue fetches each full tab.
import {cleanToken,readJson,retryAfter,failure} from '../http.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const NAMES=new Set(['edv9_last_reconcile_begin','edv9_last_reconcile_page','edv9_last_reconcile_fail','edv9_last_reconcile_fixture']);
export function createRecoveryRpc({supabaseUrl,serviceKey,fetchImpl=fetch}) {
 if(supabaseUrl!=='https://rknxqlijcgpbecoophva.supabase.co')throw failure('staging_required');
 const key=cleanToken(serviceKey);if(!key)throw failure('backend_credential_missing');
 const headers={'Content-Type':'application/json',Accept:'application/json',apikey:key};
 if(!key.startsWith('sb_secret_'))headers.Authorization='Bearer '+key;
 return async(name,args)=>{
  if(!NAMES.has(name)||!object(args))throw failure('invalid_rpc');
  try {
   const res=await fetchImpl(supabaseUrl+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers,body:JSON.stringify(args)});
   const data=await readJson(res,1100000);if(!res.ok)throw failure('storage_unavailable');return data;
  }catch{throw failure('storage_unavailable');}
 };
}
export function validatePage(rows,locationId,limit=100) {
 if(!UUID.test(locationId)||!Array.isArray(rows)||rows.length>limit)throw failure('invalid_tab');
 const ids=new Set();
 for(const row of rows){
  if(!object(row)||typeof row.id!=='string'||!UUID.test(row.id)||typeof row.locationId!=='string'||row.locationId.toLowerCase()!==locationId.toLowerCase())throw failure('invalid_tab');
  ids.add(row.id.toLowerCase());
 }
 return {ids:[...ids],row_count:rows.length};
}
export function createTabListReader({token,fetchImpl=fetch}) {
 const secret=cleanToken(token);if(!secret)throw failure('last_credential_missing');
 return {async listPage(claim){
  if(!object(claim)||!UUID.test(claim.location_id)||!Number.isInteger(claim.offset)||claim.offset<0||claim.offset>900||claim.limit!==100)throw failure('invalid_tab');
  const start=Date.parse(claim.start_date),end=Date.parse(claim.end_date);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||end-start>7*86400000)throw failure('invalid_tab');
  const url=new URL('https://api.last.app/v2/tabs');
  url.searchParams.set('locationId',claim.location_id);url.searchParams.set('startDate',new Date(start).toISOString());url.searchParams.set('endDate',new Date(end).toISOString());
  url.searchParams.set('offset',String(claim.offset));url.searchParams.set('limit','100');
  const signal=AbortSignal.timeout(12000);
  try{
   const res=await fetchImpl(url.toString(),{method:'GET',redirect:'error',signal,headers:{Authorization:'Bearer '+secret,LocationID:claim.location_id,Accept:'application/json'}});
   if(!res.ok){
    const code=[401,403].includes(res.status)?'last_unauthorized':res.status===429?'last_rate_limited':res.status>=500?'last_unavailable':'invalid_tab';
    await res.body?.cancel();throw failure(code,{retryAfterSeconds:retryAfter(res.headers.get('retry-after'))});
   }
   let rows;try{rows=await readJson(res,2000000);}catch{throw failure(signal.aborted?'last_timeout':'invalid_tab');}
   validatePage(rows,claim.location_id);return rows;
  }catch(e){
   if(signal.aborted||['TimeoutError','AbortError'].includes(e?.name))throw failure('last_timeout');
   if(['last_unauthorized','last_rate_limited','last_unavailable','last_timeout','invalid_tab'].includes(e?.code))throw e;
   throw failure('last_unavailable');
  }
 }};
}
export async function recoverPage({rpc,list,ready=false},locationId){
 if(!ready||!list)return {state:'disabled',queued:0};
 if(!UUID.test(locationId))throw failure('invalid_location');
 const claim=await rpc('edv9_last_reconcile_begin',{p_location_id:locationId});
 if(!claim)return {state:'idle',queued:0};
 if(!object(claim)||claim.location_id!==locationId||!UUID.test(claim.lease_token))throw failure('storage_unavailable');
 try{
  const page=validatePage(await list.listPage(claim),locationId);
  const result=await rpc('edv9_last_reconcile_page',{p_location_id:locationId,p_lease_token:claim.lease_token,p_ids:page.ids,p_row_count:page.row_count});
  if(!object(result)||!['partial','completed','truncated','stalled','lost_lease'].includes(result.state)||!Number.isInteger(result.queued)||result.queued<0||result.queued>100)throw failure('storage_unavailable');
  return {state:result.state,queued:result.queued};
 }catch(e){
  const code=['last_unauthorized','last_rate_limited','last_unavailable','last_timeout','invalid_tab'].includes(e?.code)?e.code:'worker_error';
  const delay=Number.isInteger(e?.retryAfterSeconds)?Math.max(0,Math.min(86400,e.retryAfterSeconds)):0;
  await rpc('edv9_last_reconcile_fail',{p_location_id:locationId,p_lease_token:claim.lease_token,p_code:code,p_delay:delay});
  return {state:'error',queued:0,error_code:code};
 }
}
