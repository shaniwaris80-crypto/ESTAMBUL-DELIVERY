declare const EdgeRuntime: {waitUntil(promise:Promise<unknown>):void};
import { createClient } from "npm:@supabase/supabase-js@2.57.0";

// Last.app v2 -> ESTAMBUL DELIVERY. Authentic webhook inbox, then private auto-sync.
// No external order is imported until its location is explicitly approved.
const env=(name:string)=>Deno.env.get(name)?.trim()||"";
// Normalize copied secret values without bypassing Last.app's Bearer authentication.
function normalizeSavedBearer(raw:string):string {
 let token=raw.trim();
 for(let i=0;i<2;i++) {
  if((token.startsWith('"')&&token.endsWith('"'))||(token.startsWith("'")&&token.endsWith("'")))
   token=token.slice(1,-1).trim();
 }
 return token.replace(/^Bearer[ \t]+/i,"").trim();
}
const enc=new TextEncoder();
function equalSecret(a:string,b:string):boolean{
  const x=enc.encode(a),y=enc.encode(b);
  let mismatch=x.length^y.length;
  const max=Math.max(x.length,y.length);
  for(let i=0;i<max;i++)mismatch|=(x[i]||0)^(y[i]||0);
  return mismatch===0;
}
const plain=(status:number)=>new Response(null,{status,headers:{"Cache-Control":"no-store"}});
Deno.serve(async(req:Request)=>{
  if(req.method==="GET"||req.method==="HEAD")
    return plain(200); // health check, does not confirm subscription
  if(req.method!=="POST")return plain(405);
  const expected=normalizeSavedBearer(env("LAST_APP_INTEGRATOR_TOKEN"));
  if(!expected){
    console.error("[ED Last webhook] credential_unconfigured");
    return plain(503);
  }
  const auth=req.headers.get("authorization")||"";
  const match=auth.match(/^Bearer[ \t]+([^\r\n]+)$/i);
  if(!match){
    console.warn("[ED Last webhook] unauthorized_missing_or_malformed_bearer");
    return plain(401);
  }
  if(!equalSecret(match[1].trim(),expected)){
    // Never log credentials, hashes, lengths, or Authorization header content.
    console.warn("[ED Last webhook] unauthorized_bearer_token_mismatch");
    return plain(401);
  }
  const contentType=req.headers.get("content-type")||"";
  if(!contentType.toLowerCase().includes("application/json"))return plain(415);
  let payload:Record<string,unknown>;
  try {
    const raw=await req.text();
    if(enc.encode(raw).length>160_000)return plain(413);
    const value=JSON.parse(raw);
    if(!value||typeof value!=="object"||Array.isArray(value))return plain(400);
    payload=value as Record<string,unknown>;
  }catch{return plain(400);}
  const eventId=payload.id,eventType=payload.type;
  if(typeof eventId!=="string"||!eventId||eventId.length>128||
     typeof eventType!=="string"||!eventType||eventType.length>100)
    return plain(400);
  const data=payload.data;
  const loc=req.headers.get("locationid")||
    (data&&typeof data==="object"&&!Array.isArray(data)&&
    typeof (data as Record<string,unknown>).locationId==="string"
      ?String((data as Record<string,unknown>).locationId):null);
  const org=req.headers.get("organizationid")||
    (data&&typeof data==="object"&&!Array.isArray(data)&&
    typeof (data as Record<string,unknown>).organizationId==="string"
      ?String((data as Record<string,unknown>).organizationId):null);
  if((loc&&loc.length>128)||(org&&org.length>128))return plain(400);
  const url=env("SUPABASE_URL"),service=env("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!service)return plain(503);
  try{
    const client=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const {error}=await client.rpc("ed_receive_last_webhook",{
      p_event_id:eventId,
      p_event_type:eventType,
      p_location_id:loc,
      p_organization_id:org,
      p_event_created_at:typeof payload.created==="string"
        ?payload.created.slice(0,60):null,
      p_data:payload
    });
    if(error){
      console.error("[ED Last webhook] event_inbox_store_failed");
      return plain(503);
    }
    console.info("[ED Last webhook] event_accepted",eventType);
    // Acknowledge Last immediately; process the order in the private worker.
    // If Last.app retries, SQL deduplication by webhook event ID and tab ID is safe.
    const work=fetch(url+"/functions/v1/ed-last-auto-sync",{
      method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+service},
      body:JSON.stringify({event_id:eventId})
    }).catch(()=>undefined);
    if(typeof EdgeRuntime!=="undefined")EdgeRuntime.waitUntil(work);
    return plain(200); // Last.app requires an empty HTTP 200
  }catch{return plain(503);}
});
