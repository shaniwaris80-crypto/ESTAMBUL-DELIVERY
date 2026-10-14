import { createClient } from "npm:@supabase/supabase-js@2.57.0";

// Last.app v2 -> ESTAMBUL DELIVERY. Inbox only; does not create, change,
// assign, or SMS any orders until a separate reviewed sync worker exists.
const env=(name:string)=>Deno.env.get(name)?.trim()||"";
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
  const expected=env("LAST_APP_INTEGRATOR_TOKEN");
  if(!expected)return plain(503); // no token: deliberately do not accept events
  const auth=req.headers.get("authorization")||"";
  const match=auth.match(/^Bearer\s+(.+)$/i);
  if(!match||!equalSecret(match[1].trim(),expected))return plain(401);
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
    if(error)return plain(503);
    return plain(200); // Last.app requires an empty HTTP 200
  }catch{return plain(503);}
});
