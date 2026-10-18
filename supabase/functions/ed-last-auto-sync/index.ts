import { createClient } from "npm:@supabase/supabase-js@2.57.0";

// Private worker: fetches a Last.app tab after its authenticated webhook.
// Never called from a phone, a browser, or a Last.app callback directly.
type Dict=Record<string,unknown>;
const env=(k:string)=>Deno.env.get(k)?.trim()||"";
const enc=new TextEncoder();
function same(a:string,b:string){
 const x=enc.encode(a),y=enc.encode(b);let diff=x.length^y.length;
 for(let i=0;i<Math.max(x.length,y.length);i++)diff|=(x[i]||0)^(y[i]||0);
 return diff===0;
}
const dict=(x:unknown):Dict=>x&&typeof x==="object"&&!Array.isArray(x)?x as Dict:{};
const val=(x:unknown):string=>typeof x==="string"?x:"";
const get=(o:Dict,k:string):string=>val(o[k]);
const json=(status:number,data:Dict)=>new Response(JSON.stringify(data),{
 status,headers:{"content-type":"application/json","cache-control":"no-store"}
});
Deno.serve(async req=>{
 if(req.method!=="POST")return json(405,{error:"method_not_allowed"});
 const service=env("SUPABASE_SERVICE_ROLE_KEY"),url=env("SUPABASE_URL");
 const last=env("LAST_APP_INTEGRATOR_TOKEN");
 const auth=req.headers.get("authorization")||"";
 const token=auth.match(/^Bearer\s+(.+)$/i)?.[1]||"";
 if(!service||!url||!same(token,service))return json(401,{error:"not_authorized"});
 if(!last)return json(503,{error:"missing_integrator_token"});
 let payload:Dict;
 try{
  const raw=await req.text();
  if(raw.length>2000)return json(413,{error:"too_large"});
  payload=dict(JSON.parse(raw));
 }catch{return json(400,{error:"invalid_json"});}
 const eventId=get(payload,"event_id");
 const drain=payload.drain===true;
 if(!drain&&(eventId.length<1||eventId.length>128))
  return json(400,{error:"event_id_required"});
 const sb=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 async function rpc<T>(method:string,args:Dict):Promise<T>{
  const {data,error}=await sb.rpc(method,args);
  if(error)throw Error(method+": "+error.message);
  return data as T;
 }
 async function perform(id:string):Promise<string>{
  try{
   const event=await rpc<Dict|null>("ed_last_get_event",{p_event_id:id});
   if(!event)throw Error("Event not found");
   const eventType=get(event,"type");
   const outer=dict(event.data);
   const detail=dict(outer.data);
   const location=get(event,"location_id")||get(detail,"locationId");
   const organization=get(event,"organization_id")||get(detail,"organizationId");
   if(eventType==="location:integrated"){
    if(!location)throw Error("Integration event has no location");
    await rpc("ed_last_record_location",{
      p_location_id:location,
      p_organization_id:organization||null,
      p_location_name:get(detail,"locationName")||null
    });
   }else if(eventType==="location:desintegrated"){
    if(location)await rpc("ed_last_disable_location",{p_location_id:location});
   }else if(["tab:created","tab:updated","tab:cancelled","tab:closed","tab:delivery-status-updated","delivery-status:updated"].includes(eventType)){
    const innerTab=dict(detail.tab);
    const tabId=get(detail,"tabId")||get(detail,"id")||get(innerTab,"id")||
      get(detail,"orderId");
    if(!location||!tabId||!/^[a-f0-9-]{36}$/i.test(tabId))throw Error("Missing valid tabId/locationId");
    if(eventType==="tab:cancelled"){
      await rpc("ed_last_cancel_tab",{p_location_id:location,p_tab_id:tabId});
    }else{
      // Only Last.app is source-of-truth. Never trust partial webhook customer details.
      const response=await fetch("https://api.last.app/v2/tabs/"+encodeURIComponent(tabId),{
        headers:{"Authorization":"Bearer "+last,"LocationID":location,"Accept":"application/json"},
        signal:AbortSignal.timeout(12000)
      });
      if(!response.ok)throw Error("Last.app tab fetch failed: HTTP "+response.status);
      const tab=dict(await response.json());
      if(!Object.keys(tab).length)throw Error("Last.app returned an empty tab");
      const imported=await rpc<Dict>("ed_last_import_tab",{p_location_id:location,p_tab_id:tabId,p_tab:tab});
      // Feature gated until schema, RLS, and menu completeness are validated.
      // Do not fail order reception if the optional snapshot import fails.
      if(env("ED_RIDER_ITEMS_INGEST_ENABLED")!=="false"&&!imported?.ignored){
       try{
        await rpc("ed_last_upsert_item_snapshot",{p_location_id:location,p_tab_id:tabId,p_tab:tab});
       }catch{
        console.warn("Order item snapshot unavailable; original Last.app order was preserved");
       }
      }
    }
   }
   await rpc("ed_last_mark_event",{p_event_id:id,p_error:null});
   return "processed";
  }catch(err){
   // Secrets and personal data are never logged.
   const message=err instanceof Error?err.message:"Unknown worker error";
   try{await rpc("ed_last_mark_event",{p_event_id:id,p_error:message});}catch{}
   return "failed";
  }
 }
 try{
  const ids=drain?await rpc<string[]>("ed_last_pending_events",{p_limit:20}):[eventId];
  let processed=0,failed=0;
  for(const id of ids){if(await perform(id)==="processed")processed++;else failed++;}
  return json(200,{processed,failed});
 }catch{return json(503,{error:"worker_failed"});}
});
