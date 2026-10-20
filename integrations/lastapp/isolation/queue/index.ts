// Staging queue worker. No production token is reused and no notifications are sent.
import {createRpcStore,createLastReader} from '../http.mjs';
import {createQueueRpc,createDrainHandler} from './drain.mjs';
const ORIGIN='https://rknxqlijcgpbecoophva.supabase.co';
const env=(key:string)=>Deno.env.get(key)?.trim()||'';
Deno.serve(async(request:Request)=>{
 if(env('SUPABASE_URL').replace(/\/$/,'')!==ORIGIN)return new Response(null,{status:503});
 const action=new URL(request.url).pathname.split('/').filter(Boolean).at(-1);
 if(action==='health'&&request.method==='GET')return new Response(JSON.stringify({module:'edv9-last-queue',staging:true}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(action!=='drain')return new Response(null,{status:404});
 try{
  const serviceKey=env('SUPABASE_SERVICE_ROLE_KEY');
  const token=env('EDV9_LAST_SANDBOX_TOKEN');
  const enabled=env('EDV9_LAST_SANDBOX_ENABLED')==='true';
  const store=createRpcStore({supabaseUrl:ORIGIN,serviceKey});
  const rpc=createQueueRpc({supabaseUrl:ORIGIN,serviceKey});
  const last=enabled&&token?createLastReader({token}):null;
  return await createDrainHandler({store,rpc,last,sandboxEnabled:enabled,sandboxTokenPresent:!!token})(request);
 }catch{return new Response(null,{status:503});}
});
