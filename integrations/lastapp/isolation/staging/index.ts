// Staging entrypoint only. Never deploy this test gateway to production.
import {createRpcStore,createLastReader,createGateway} from '../http.mjs';
import {runProbe} from './probe.mjs';
declare const EdgeRuntime: {waitUntil(task:Promise<unknown>):void};
const STAGING_ORIGIN='https://rknxqlijcgpbecoophva.supabase.co';
const env=(name:string)=>Deno.env.get(name)?.trim()||'';
Deno.serve(async(request:Request)=>{
 const origin=env('SUPABASE_URL').replace(/\/$/,'');
 if(origin!==STAGING_ORIGIN)return new Response(null,{status:503});
 try{
  const store=createRpcStore({supabaseUrl:origin,serviceKey:env('SUPABASE_SERVICE_ROLE_KEY')});
  const action=new URL(request.url).pathname.split('/').filter(Boolean).at(-1);
  if(action==='probe'){
   if(request.method!=='POST')return new Response(null,{status:405});
   return await runProbe(request,store);
  }
  // Sandbox opt-in is independent of any existing production integration token.
  const webhookToken=env('EDV9_LAST_SANDBOX_TOKEN');
  const enabled=env('EDV9_LAST_SANDBOX_ENABLED')==='true'&&!!webhookToken;
  const last=enabled?createLastReader({token:webhookToken}):null;
  const gateway=createGateway({store,last,webhookToken,workerToken:env('SUPABASE_SERVICE_ROLE_KEY'),enabled,
   schedule:(task:Promise<unknown>)=>EdgeRuntime.waitUntil(task)});
  return await gateway(request);
 }catch{return new Response(JSON.stringify({error:'service_unavailable'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
});
