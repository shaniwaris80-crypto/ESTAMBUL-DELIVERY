import { createClient } from "npm:@supabase/supabase-js@2.57.0";

// Accept a service-role invocation for trusted queue draining, or an authenticated
// Rider requesting dispatch ONLY for the status of their own assigned order.
const allowedOrigin="https://shaniwaris80-crypto.github.io";
const textHeaders={
  "Content-Type":"application/json","Cache-Control":"no-store",
  "Access-Control-Allow-Origin":allowedOrigin,
  "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods":"POST,OPTIONS"
};
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:textHeaders});
const env=(name:string)=>Deno.env.get(name)||"";
const formats=new Set(["asignado","recogido","en_ruta","entregado","cancelado"]);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function toE164(value:unknown):string|null{
 const raw=String(value||"").trim();
 const digits=raw.replace(/\D/g,"");
 if(raw.startsWith("+")&&/^[1-9]\d{7,14}$/.test(digits))return "+"+digits;
 if(/^00[1-9]\d{7,14}$/.test(digits))return "+"+digits.slice(2);
 if(/^[6789]\d{8}$/.test(digits))return "+34"+digits;
 return null;
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:textHeaders});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const origin=req.headers.get("origin");
 if(origin&&origin!==allowedOrigin)return json({error:"Origin not allowed"},403);
 const service=env("SUPABASE_SERVICE_ROLE_KEY");
 const url=env("SUPABASE_URL");
 const authHeader=req.headers.get("Authorization")||"";
 if(!service||!url)return json({error:"Server configuration missing"},503);
 const privileged=authHeader==="Bearer "+service;
 let orderId:string|null=null;
 if(!privileged){
   // Never allow a Rider to process another person's queue.
   const bearer=authHeader.match(/^Bearer\s+(.+)$/i)?.[1]||"";
   const anon=env("SUPABASE_ANON_KEY");
   if(!bearer||!anon)return json({error:"Unauthorized"},401);
   let request:{order_id?:unknown};
   try{request=await req.json()}catch{return json({error:"Invalid JSON"},400);}
   if(!uuid.test(String(request?.order_id||"")))return json({error:"Invalid order"},400);
   const userClient=createClient(url,anon,{
     global:{headers:{Authorization:authHeader}},
     auth:{persistSession:false,autoRefreshToken:false}
   });
   const {data:userInfo,error:authError}=await userClient.auth.getUser(bearer);
   if(authError||!userInfo?.user)return json({error:"Unauthorized"},401);
   const {data:orders,error:ordersError}=await userClient.from("ed_orders")
      .select("id,account_id,rider_id,status,notifications_consent,notification_channel")
      .eq("id",String(request.order_id)).limit(1);
   const order=orders?.[0];
   if(ordersError||!order||!formats.has(order.status)||!order.rider_id)
     return json({error:"Order unavailable"},403);
   const {data:riders,error:riderError}=await userClient.from("ed_riders")
      .select("id").eq("id",order.rider_id).eq("account_id",order.account_id)
      .eq("user_id",userInfo.user.id).eq("active",true).limit(1);
   if(riderError||!riders?.length)return json({error:"Not the assigned Rider"},403);
   orderId=order.id;
   if(!order.notifications_consent||!["sms","whatsapp"].includes(order.notification_channel))
     return json({enabled:true,claimed:0,accepted:0,failed:0,reason:"Notifications not authorized"});
 }
 if(env("ESTAMBUL_MESSAGING_ENABLED")!=="true")
   return json({enabled:false,processed:0,reason:"Sender disabled"});
 const sid=env("TWILIO_ACCOUNT_SID"),secret=env("TWILIO_AUTH_TOKEN");
 const smsFrom=toE164(env("TWILIO_SMS_FROM"));
 const whatsappFrom=toE164(env("TWILIO_WHATSAPP_FROM"));
 if(!sid||!secret||(!smsFrom&&!whatsappFrom))
   return json({error:"Messaging sender not configured"},503);
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:queued,error:claimError}=orderId
   ?await db.rpc("ed_claim_order_notifications",{p_order_id:orderId})
   :await db.rpc("ed_claim_notifications",{p_limit:8});
 if(claimError)return json({error:"Unable to claim notifications"},503);
 const jobs=Array.isArray(queued)?queued:[];
 const outcome={claimed:jobs.length,accepted:0,failed:0};
 for(const item of jobs){
   // Mark secondary SMS notifications as handled without contacting Twilio or retrying.
   if(item.channel==="sms"){
     const {error:finishError}=await db.rpc("ed_finish_notification",{
       p_id:item.id,p_ok:true,p_provider_id:null,p_error:null
     });
     if(finishError)outcome.failed++;
     continue;
   }
   let sent=false,providerId="",errorMessage="";
   try{
     const id=String(item.id||"");
     const to=toE164(item.to),channel=String(item.channel||"");
     const status=String(item.status||"");
     if(!uuid.test(id)||!to)throw Error("Invalid destination");
     if(!formats.has(status))throw Error("Unsupported status");
     const form=new URLSearchParams();
     if(channel==="sms"){
       // Single-SMS policy: acceptance link is sent only by ed-rider-accept-sms.
       // Status updates belong inside the same tracking link, never by extra SMS.
       throw Error("Status SMS disabled by single-message policy");
       if(!smsFrom)throw Error("SMS sender unavailable");
       form.set("To",to);form.set("From",smsFrom);
       form.set("Body",String(item.body||"").slice(0,420));
     }else if(channel==="whatsapp"){
       const template=env("TWILIO_WA_TEMPLATE_"+status.toUpperCase());
       if(!/^HX[a-fA-F0-9]{32}$/.test(template))throw Error("Approved WhatsApp template missing");
       if(!whatsappFrom)throw Error("WhatsApp sender unavailable");
       form.set("To","whatsapp:"+to);form.set("From","whatsapp:"+whatsappFrom);
       form.set("ContentSid",template);
       form.set("ContentVariables",JSON.stringify({"1":String(item.reference||"")}));
     }else throw Error("Unknown channel");
     const response=await fetch("https://api.twilio.com/2010-04-01/Accounts/"+
       encodeURIComponent(sid)+"/Messages.json",{
       method:"POST",headers:{"Authorization":"Basic "+btoa(sid+":"+secret),
         "Content-Type":"application/x-www-form-urlencoded"},body:form.toString()
     });
     const raw=await response.text();
     let payload:Record<string,unknown>={};try{payload=JSON.parse(raw)}catch{}
     if(!response.ok)
       throw Error("Twilio rejected: HTTP "+response.status+", code "+String(payload.code||"unknown"));
     sent=true;providerId=String(payload.sid||"");
     outcome.accepted++;
   }catch(error){
     errorMessage=error instanceof Error?error.message:"SMS failed";
     outcome.failed++;
   }
   await db.rpc("ed_finish_notification",{
     p_id:item.id,p_ok:sent,p_provider_id:providerId||null,p_error:sent?null:errorMessage
   });
 }
 return json({enabled:true,...outcome,note:"accepted means Twilio accepted; handset delivery is not confirmed"});
});