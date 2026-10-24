import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
import { createApi } from './api.mjs';
import { credentialStore } from './runtime.mjs';
const environment=(key:string)=>Deno.env.get(key)||'';
const db=createClient(environment('SUPABASE_URL'),environment('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(async req=>{
 try{const secrets=await credentialStore(db,environment);return createApi({db,env:secrets.env,saveSecrets:secrets.save})(req);}
 catch{return new Response(JSON.stringify({error:'service_unavailable'}),{status:503,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});}
});
