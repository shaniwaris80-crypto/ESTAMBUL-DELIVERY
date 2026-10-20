// Replacement of the NEW staging queue only; original production functions are untouched.
import {createRpcStore,createLastReader,cleanToken,sha256} from '../http.mjs';
import {createQueueRpc,drainBatch} from '../queue/drain.mjs';
import {createRecoveryRpc,createTabListReader,recoverPage} from './reconcile.mjs';
const origin='https://rknxqlijcgpbecoophva.supabase.co';
const env=(key:string)=>Deno.env.get(key)?.trim()||'';
Deno.serve(async(request:Request)=>{
 if(env('SUPABASE_URL').replace(/\/$/,'')!==origin)return new Response(null,{status:503});
 if(request.method!=='POST')return new Response(null,{status:405});
 const token=request.headers.get('authorization')?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
 if(!token)return new Response(null,{status:401});
 const started=Date.now();
 try{
  const options={supabaseUrl:origin,serviceKey:env('SUPABASE_SERVICE_ROLE_KEY')};
  const rpc=createQueueRpc(options),recovery=createRecoveryRpc(options),store=createRpcStore(options);
  const ticket=await rpc('edv9_last_queue_begin',{p_hash:await sha256(token)});
  if(!ticket)return new Response(null,{status:401});
  if(!Array.isArray(ticket.routes)||ticket.routes.length>8)throw Error('invalid_ticket');
  const sandboxToken=cleanToken(env('EDV9_LAST_SANDBOX_TOKEN'));
  const sandboxEnabled=env('EDV9_LAST_SANDBOX_ENABLED')==='true';
  const ready=sandboxEnabled&&!!sandboxToken;
  const last=ready?createLastReader({token:sandboxToken}):null;
  let poll={state:'idle',queued:0};
  // One page per scheduler invocation, sharing the database lease with full-tab fetches.
  for(const route of ticket.routes){
   if(Date.now()-started>=15000)break;
   const synthetic=route.source_kind==='synthetic';
   const list=synthetic?{listPage:(c:any)=>recovery('edv9_last_reconcile_fixture',{p_location_id:c.location_id,p_lease_token:c.lease_token,p_offset:c.offset})}:ready?createTabListReader({token:sandboxToken}):null;
   poll=await recoverPage({rpc:recovery,list,ready:synthetic||ready},route.location_id);
   if(!['idle','disabled'].includes(poll.state))break;
  }
  const report=await drainBatch({routes:ticket.routes,store,rpc,last,sandboxEnabled,sandboxTokenPresent:!!sandboxToken,startBudgetMs:Math.max(0,15000-(Date.now()-started))});
  report.queue_enabled=ticket.queue_enabled===true;
  const finished=await rpc('edv9_last_queue_finish',{p_run_id:ticket.run_id,p_report:report});
  if(finished!==true)throw Error('unfinished_run');
  return new Response(JSON.stringify({...report,reconciliation:poll}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 }catch{return new Response(JSON.stringify({error:'queue_unavailable'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
});
