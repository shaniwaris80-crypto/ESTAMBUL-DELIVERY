import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const allowedOrigin="https://shaniwaris80-crypto.github.io";
const trackBase="https://shaniwaris80-crypto.github.io/ESTAMBUL-DELIVERY/track.html";
const headers={
 "Access-Control-Allow-Origin":allowedOrigin,
 "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
 "Access-Control-Allow-Methods":"POST, OPTIONS",
 "Cache-Control":"no-store",
 "Content-Type":"application/json"
};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
const env=(key:string)=>Deno.env.get(key)||"";
const toE164=(raw:unknown)=>{
 const original=String(raw||"").trim(),digits=original.replace(/\D/g,"");
 if(original.startsWith("+")&&/^[1-9]\d{7,14}$/.test(digits))return "+"+digits;
 if(/^00[1-9]\d{7,14}$/.test(digits))return "+"+digits.slice(2);
 if(/^[6789]\d{8}$/.test(digits))return "+34"+digits;
 return null;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const origin=req.headers.get("origin");
 if(origin&&origin!==allowedOrigin)return json({error:"Origin not allowed"},403);
 const bearer=req.headers.get("authorization")||"";
 const jwt=bearer.startsWith("Bearer ")?bearer.slice(7):"";
 if(!jwt)return json({error:"Inicia sesión como Rider"},401);
 const supabaseUrl=env("SUPABASE_URL"),publishable=env("SUPABASE_ANON_KEY");
 if(!supabaseUrl||!publishable)return json({error:"Missing server configuration"},503);
 let input:{order_id?:unknown;resend?:unknown};
 try{input=await req.json();}catch{return json({error:"Invalid payload"},400);}
 const orderId=String(input?.order_id||"");
 if(!uuid.test(orderId)||typeof input.resend!=="undefined"&&typeof input.resend!=="boolean")
  return json({error:"Invalid order"},400);
 try{
  const client=createClient(supabaseUrl,publishable,{
   global:{headers:{Authorization:bearer}},
   auth:{persistSession:false,autoRefreshToken:false}
  });
  const auth=await client.auth.getUser(jwt);
  if(auth.error||!auth.data.user)return json({error:"Sesión de Rider no válida"},401);
  const {data:accepted,error:acceptError}=await client.rpc("ed_rider_accept_tracking",{
   p_order_id:orderId,p_resend:false
  });
  if(acceptError)return json({error:acceptError.message||"Pedido no autorizado"},403);
  if(!accepted?.accepted)return json({error:"Pedido no aceptado"},409);
  if(accepted.already_accepted||!accepted.link_created)
   return json({accepted:true,already_accepted:Boolean(accepted.already_accepted),sms_status:"already_accepted"});

  const token=String(accepted.token||"");
  if(!/^[a-f0-9]{64}$/.test(token))return json({accepted:true,sms_status:"link_error"});
  const track=trackBase+"#token="+token;
  const result={accepted:true,link:track,sms_status:"not_requested"};
  // One transactional SMS on first acceptance. Never resend from this endpoint.

  // Rider can read only orders assigned to himself through RLS.
  const {data:order,error:orderError}=await client.from("ed_orders")
    .select("id,reference,customer_phone,notifications_consent,notification_channel,accepted_at,status")
    .eq("id",orderId).single();
  if(orderError||!order||!order.accepted_at||
     !["asignado","recogido","en_ruta"].includes(order.status)){
    return json({...result,sms_status:"permission_or_order_error"});
  }
  if(!order.notifications_consent||order.notification_channel!=="sms"){
    return json({...result,sms_status:"sms_not_authorized"});
  }
  const to=toE164(order.customer_phone);
  if(!to)return json({...result,sms_status:"invalid_phone"});
  if(env("ESTAMBUL_MESSAGING_ENABLED")!=="true"){
    return json({...result,sms_status:"provider_disabled"});
  }
  const sid=env("TWILIO_ACCOUNT_SID"),secret=env("TWILIO_AUTH_TOKEN");
  const from=env("TWILIO_SMS_FROM"),callbackUrl=env("TWILIO_STATUS_CALLBACK_URL");
  const service=env("SUPABASE_SERVICE_ROLE_KEY");
  if(!sid||!secret||!toE164(from)||!service)
    return json({...result,sms_status:"provider_not_configured"});
  let callback:URL;
  try{callback=new URL(callbackUrl);}catch{return json({...result,sms_status:"status_callback_not_configured"});}
  let projectHost="";
  try{projectHost=new URL(supabaseUrl).hostname;}catch{}
  if(callback.protocol!=="https:"||callback.hostname!==projectHost||
     callback.pathname!=="/functions/v1/ed-twilio-status"||callback.search||callback.hash)
    return json({...result,sms_status:"status_callback_not_configured"});

  const form=new URLSearchParams();
  form.set("To",to);form.set("From",from);
  form.set("StatusCallback",callbackUrl);
  form.set("Body","Seguimiento de tu pedido #"+String(order.reference||"")+
   " de ESTAMBUL DELIVERY:\n"+track);

  let success=false,messageSid="",providerError="",deliveryStatus="provider_rejected",attempts=0;
  for(let attempt=1;attempt<=2;attempt++){
   attempts=attempt;
   try{
    const response=await fetch("https://api.twilio.com/2010-04-01/Accounts/"+
       encodeURIComponent(sid)+"/Messages.json",{
      method:"POST",
      headers:{"Authorization":"Basic "+btoa(sid+":"+secret),
       "Content-Type":"application/x-www-form-urlencoded"},
      body:form.toString(),
      // Only explicit Twilio rate limiting is safe to retry. Network/5xx outcomes stay manual.
      signal:AbortSignal.timeout(8000)
    });
    const raw=await response.text();
    let data:Record<string,unknown>={};
    try{data=raw?JSON.parse(raw):{}}catch{}
    if(response.ok){
     messageSid=String(data.sid||"");
     if(messageSid){
      success=true;deliveryStatus="provider_accepted";
     }else{
      deliveryStatus="unknown";
      providerError="Twilio returned success without a message SID";
     }
     break;
    }
    const code=Number(data.code||0);
    if(response.status===429&&code===20429&&attempt===1){
     providerError="Twilio rate limited the first attempt; one safe retry was made";
     await new Promise(resolve=>setTimeout(resolve,350));
     continue;
    }
    providerError="Twilio error "+response.status+" ("+String(data.code||"unknown")+")";
    deliveryStatus=response.status>=500?"unknown":"provider_rejected";
    break;
   }catch{
    providerError="Twilio timeout or network error; outcome unknown";
    deliveryStatus="unknown";
    break;
   }
  }

  const audit=createClient(supabaseUrl,service,{
   auth:{persistSession:false,autoRefreshToken:false}
  });
  const {error:auditError}=await audit.rpc("ed_log_tracking_sms",{
   p_order_id:orderId,p_token:token,p_success:success,
   p_provider_sid:messageSid||null,p_error:providerError||null,
   p_attempt_count:attempts,p_delivery_status:deliveryStatus
  });
  if(auditError){
   return json({...result,sms_status:success?"provider_accepted_audit_pending":"audit_error"});
  }
  if(success)return json({...result,sms_status:"provider_accepted"});
  if(deliveryStatus==="unknown")return json({...result,sms_status:"provider_outcome_unknown"});
  return json({...result,sms_status:attempts===2?"provider_retry_exhausted":"provider_rejected"});
 }catch{
  return json({error:"Error al aceptar el pedido o preparar su seguimiento"},503);
 }
});
