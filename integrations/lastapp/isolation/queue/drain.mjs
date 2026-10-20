import {processOne} from '../contract.mjs';
import {readJson,sha256,cleanToken,failure} from '../http.mjs';
const NAMES=new Set(['edv9_last_queue_begin','edv9_last_queue_claim','edv9_last_queue_fixture','edv9_last_queue_finish']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
export function createQueueRpc({supabaseUrl,serviceKey,fetchImpl=fetch}) {
 if(supabaseUrl!=='https://rknxqlijcgpbecoophva.supabase.co')throw failure('staging_required');
 const key=cleanToken(serviceKey);if(!key)throw failure('backend_credential_missing');
 const headers={'Content-Type':'application/json',Accept:'application/json',apikey:key};
 if(!key.startsWith('sb_secret_'))headers.Authorization='Bearer '+key;
 return async function rpc(name,args) {
  if(!NAMES.has(name)||!object(args))throw failure('invalid_rpc');
  try{
   const res=await fetchImpl(supabaseUrl+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers,body:JSON.stringify(args)});
   const result=await readJson(res,1100000);
   if(!res.ok)throw failure('queue_storage_unavailable');
   return result;
  }catch{throw failure('queue_storage_unavailable');}
 };
}
/** A bounded batch; events, delay and leases stay in PostgreSQL between invocations. */
export async function drainBatch({routes,store,rpc,last,sandboxEnabled=false,sandboxTokenPresent=false,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),maxJobs=20,startBudgetMs=15000}) {
 if(!Array.isArray(routes)||routes.length>8||routes.some(r=>!object(r)||!UUID.test(r.location_id)||!['sandbox','synthetic'].includes(r.source_kind)))throw failure('invalid_routes');
 if(!Number.isInteger(maxJobs)||maxJobs<1||maxJobs>20||startBudgetMs<0||startBudgetMs>15000)throw failure('invalid_budget');
 const report={processed:0,ignored:0,retry:0,dead:0,lost_lease:0,idle:0,storage_errors:0,attempted:0,synthetic_reads:0,sandbox_reads:0,sandbox_enabled:sandboxEnabled,sandbox_token_present:sandboxTokenPresent};
 const active=routes.filter(r=>r.source_kind==='synthetic'||(sandboxEnabled&&sandboxTokenPresent&&last));
 const stopped=new Set(),start=now();
 // Claim checks the current route and switch again; a route disabled after begin cannot run.
 const queueStore={...store,claim:location=>rpc('edv9_last_queue_claim',{p_location_id:location})};
 while(report.attempted<maxJobs && now()-start<startBudgetMs) {
  let worked=false;
  for(const route of active) {
   if(stopped.has(route.location_id)||report.attempted>=maxJobs||now()-start>=startBudgetMs)continue;
   const reader=route.source_kind==='synthetic'?{getTab:async(tabId,location)=>{
    report.synthetic_reads++;
    const f=await rpc('edv9_last_queue_fixture',{p_location_id:location,p_tab_id:tabId});
    if(!object(f)||!object(f.tab))throw failure('invalid_tab');
    if(f.fail_first===true&&f.attempt===1)throw failure('last_unavailable');
    return f.tab;
   }}:{getTab:async(...args)=>{report.sandbox_reads++;return last.getTab(...args);}};
   try{
    const result=await processOne({store:queueStore,last:reader},route.location_id);
    if(result.state==='idle'){report.idle++;stopped.add(route.location_id);continue;}
    report.attempted++;worked=true;
    if(['processed','ignored','retry','dead','lost_lease'].includes(result.state))report[result.state]++;
    else{report.storage_errors++;stopped.add(route.location_id);}
    if(['retry','dead','lost_lease'].includes(result.state))stopped.add(route.location_id);
   }catch{report.storage_errors++;stopped.add(route.location_id);}
  }
  if(!worked||active.every(r=>stopped.has(r.location_id)))break;
  // Respect the existing 500ms per-location request interval. No busy polling for delayed retries.
  if(report.attempted<maxJobs && now()-start<startBudgetMs)await sleep(600);
 }
 return report;
}
const empty=status=>new Response(null,{status,headers:{'Cache-Control':'no-store'}});
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export function createDrainHandler(deps) {
 return async request=>{
  if(request.method!=='POST')return empty(405);
  const token=request.headers.get('authorization')?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
  if(!token)return empty(401);
  try{
   const ticket=await deps.rpc('edv9_last_queue_begin',{p_hash:await sha256(token)});
   if(!ticket)return empty(401);
   if(!UUID.test(ticket.run_id)||!Array.isArray(ticket.routes))return empty(503);
   const report=await drainBatch({...deps,routes:ticket.routes});
   report.queue_enabled=ticket.queue_enabled===true;
   const finished=await deps.rpc('edv9_last_queue_finish',{p_run_id:ticket.run_id,p_report:report});
   if(finished!==true)return empty(503);
   return json(200,report);
  }catch{return json(503,{error:'queue_unavailable'});}
 };
}
