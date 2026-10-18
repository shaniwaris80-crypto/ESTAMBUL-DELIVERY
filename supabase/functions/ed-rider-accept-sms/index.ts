import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const allowedOrigin="https://shaniwaris80-crypto.github.io";
const trackBase="https://shaniwaris80-crypto.github.io/ESTAMBUL-DELIVERY/track.html";
const headers={
 "Access-Control-Allow-Origin":allowedOrigin,
 "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
 "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
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
const isContentSid=(value:string)=>/^HX[0-9a-fA-F]{32}$/.test(value);
const isAccountSid=(value:string)=>/^AC[0-9a-fA-F]{32}$/.test(value);
// WhatsApp templates are ACCOUNT-SCOPED and must be approved before sending.
// Failure before the claim allows a manual (explicit) fallback; after claim,
// do not retry because ambiguous timeouts may still have created a message.
async function checkWhatsAppTemplate(accountSid:string,secret:string,contentSid:string){
 const authorization="Basic "+btoa(accountSid+":"+secret);
 const url="https://content.twilio.com/v1/Content/"+encodeURIComponent(contentSid);
 try{
  const [contentRes,approvalRes]=await Promise.all([
    fetch(url,{headers:{Authorization:authorization},signal:AbortSignal.timeout(6500)}),
    fetch(url+"/ApprovalRequests",{headers:{Authorization:authorization},signal:AbortSignal.timeout(6500)})
  ]);
  if(!contentRes.ok)return "template_not_found";
  const content=await contentRes.json();
  if(content.account_sid!==accountSid)return "wrong_template_account";
  if(!approvalRes.ok)return "approval_unavailable";
  const approved=await approvalRes.json();
  return approved?.whatsapp?.status==="approved"?null:"template_not_approved";
 }catch{return "template_check_failed";}
}

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST"&&req.method!=="GET")return json({error:"Method not allowed"},405);
 const origin=req.headers.get("origin");
 if(origin&&origin!==allowedOrigin)return json({error:"Origin not allowed"},403);
 const bearer=req.headers.get("authorization")||"";
 const jwt=bearer.startsWith("Bearer ")?bearer.slice(7):"";
 if(!jwt)return json({error:"Inicia sesión como Rider"},401);
 const supabaseUrl=env("SUPABASE_URL"),publishable=env("SUPABASE_ANON_KEY");
 if(!supabaseUrl||!publishable)return json({error:"Missing server configuration"},503);
 // Read-only health check. No Twilio contact, message or claim occurs here.
 // Only a signed-in active Rider can see coarse non-secret readiness flags.
 if(req.method==="GET"){
  try{
   const client=createClient(supabaseUrl,publishable,{
    global:{headers:{Authorization:bearer}},
    auth:{persistSession:false,autoRefreshToken:false}
   });
   const current=await client.auth.getUser(jwt);
   if(current.error||!current.data.user)return json({error:"Sesión no válida"},401);
   const {data:roster,error:rosterError}=await client.from("ed_riders")
    .select("id").eq("user_id",current.data.user.id).eq("active",true).limit(1);
   if(rosterError||!roster?.length)return json({error:"Solo Rider activo"},403);
   const enabled=env("ESTAMBUL_MESSAGING_ENABLED")==="true";
   const configuredProvider=Boolean(env("TWILIO_ACCOUNT_SID")&&env("TWILIO_AUTH_TOKEN")&&toE164(env("TWILIO_SMS_FROM")));
   const service=Boolean(env("SUPABASE_SERVICE_ROLE_KEY"));
   const whatsappFlag=env("ESTAMBUL_WHATSAPP_ENABLED")==="true";
   const whatsappConfigured=isAccountSid(env("TWILIO_ACCOUNT_SID"))&&
     Boolean(env("TWILIO_AUTH_TOKEN"))&&
     Boolean(toE164(env("TWILIO_WHATSAPP_FROM")))&&
     isContentSid(env("TWILIO_WHATSAPP_CONTENT_SID"));
   return json({ready:enabled&&configuredProvider&&service,
    reason:!enabled?"disabled":!configuredProvider?"provider_not_configured":!service?"dispatch_unavailable":"configured",
    whatsapp_configured:whatsappFlag&&whatsappConfigured&&service,
    whatsapp_reason:!whatsappFlag?"disabled":!whatsappConfigured?"provider_not_configured":!service?"dispatch_unavailable":"configured_requires_template_check",
    note:"Configuración local verificada; no demuestra aprobación de plantilla ni recepción del mensaje."});
  }catch{return json({error:"No se pudo consultar la configuración del SMS"},503);}
 }
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
  // One private tracking link per accepted order. Never re-issue via Rider.
  // Manual rescue requires a separate administrator-controlled workflow.
  if(input.resend===true)return json({error:"No se generan enlaces ni SMS nuevos al reenviar. Utiliza el enlace inicial."},409);
  const {data:accepted,error:acceptError}=await client.rpc("ed_rider_accept_tracking",{
   p_order_id:orderId,p_resend:false
  });
  if(acceptError)return json({error:acceptError.message||"Pedido no autorizado"},403);
  if(!accepted?.accepted)return json({error:"Pedido no aceptado"},409);
  if(!accepted.link_created)
   return json({accepted:true,already_accepted:Boolean(accepted.already_accepted),sms_status:"already_accepted"});

  const token=String(accepted.token||"");
  if(!/^[a-f0-9]{64}$/.test(token))return json({accepted:true,sms_status:"link_error"});
  const track=trackBase+"#token="+token;
  const result={accepted:true,link:track,sms_status:"not_requested"};

  // Rider can read only orders assigned to himself through RLS.
  const {data:order,error:orderError}=await client.from("ed_orders")
    .select("id,reference,customer_phone,notifications_consent,notification_channel,accepted_at,status")
    .eq("id",orderId).single();
  if(orderError||!order||!order.accepted_at||
     !["asignado","recogido","en_ruta"].includes(order.status)){
    return json({...result,sms_status:"permission_or_order_error"});
  }
  if(order.notification_channel==="whatsapp"){
   if(!order.notifications_consent)return json({...result,whatsapp_status:"not_authorized"});
   const to=toE164(order.customer_phone);
   if(!to)return json({...result,whatsapp_status:"invalid_phone"});
   if(env("ESTAMBUL_WHATSAPP_ENABLED")!=="true")
    return json({...result,whatsapp_status:"provider_disabled"});
   const sid=env("TWILIO_ACCOUNT_SID"),secret=env("TWILIO_AUTH_TOKEN"),
     contentSid=env("TWILIO_WHATSAPP_CONTENT_SID"),
     from=toE164(env("TWILIO_WHATSAPP_FROM"));
   if(!isAccountSid(sid)||!secret||!isContentSid(contentSid)||!from)
    return json({...result,whatsapp_status:"provider_not_configured"});
   // Sandbox is for allow-listed test phones only, never normal customers.
   if(from==="+14155238886"&&!(
     env("ESTAMBUL_WHATSAPP_TEST_MODE")==="true"&&
     env("TWILIO_WHATSAPP_TEST_TO")===to
   ))return json({...result,whatsapp_status:"sandbox_only"});
   // The Twilio 21655 error is a wrong, missing or other-account Content SID.
   // Check ownership AND WhatsApp approval before consuming the one-time claim.
   const templateIssue=await checkWhatsAppTemplate(sid,secret,contentSid);
   if(templateIssue)return json({...result,whatsapp_status:templateIssue});
   const service=env("SUPABASE_SERVICE_ROLE_KEY");
   if(!service)return json({...result,whatsapp_status:"dispatch_unavailable"});
   const audit=createClient(supabaseUrl,service,{
    auth:{persistSession:false,autoRefreshToken:false}
   });
   const {data:claimed,error:claimError}=await audit.rpc("ed_claim_one_tracking_whatsapp",{p_order_id:orderId});
   if(claimError)return json({...result,whatsapp_status:"dispatch_unavailable"});
   if(claimed!==true)return json({...result,whatsapp_status:"already_sent_or_attempted"});
   const form=new URLSearchParams();
   form.set("To","whatsapp:"+to);form.set("From","whatsapp:"+from);
   form.set("ContentSid",contentSid);
   form.set("ContentVariables",JSON.stringify({"1":String(order.reference||"Pedido"),"2":track}));
   // Do NOT include Body/MediaUrl with ContentSid.
   let acceptedByProvider=false,messageSid="",errorCode="";
   try{
    const response=await fetch("https://api.twilio.com/2010-04-01/Accounts/"+
     encodeURIComponent(sid)+"/Messages.json",{
      method:"POST",
      headers:{"Authorization":"Basic "+btoa(sid+":"+secret),
       "Content-Type":"application/x-www-form-urlencoded"},
      body:form.toString(),signal:AbortSignal.timeout(10000)
    });
    const data=await response.json().catch(()=>({}));
    if(response.ok){acceptedByProvider=true;messageSid=String(data.sid||"");}
    else errorCode=String(data.code||response.status);
   }catch{errorCode="network_ambiguous";}
   // A claim remains SPENT even when the HTTP response is ambiguous.
   const {error:finishError}=await audit.rpc("ed_finish_one_tracking_whatsapp",{
    p_order_id:orderId,p_accepted:acceptedByProvider,
    p_provider_sid:messageSid||null,p_error_code:errorCode||null
   });
   if(finishError)return json({...result,whatsapp_status:"attempt_unverified"});
   return json({...result,whatsapp_status:acceptedByProvider?"provider_accepted":"provider_rejected",
    ...(errorCode?{provider_error_code:errorCode}:{})});
  }
  if(!order.notifications_consent||order.notification_channel!=="sms"){
    return json({...result,sms_status:"sms_not_authorized"});
  }
  const to=toE164(order.customer_phone);
  if(!to)return json({...result,sms_status:"invalid_phone"});
  if(env("ESTAMBUL_MESSAGING_ENABLED")!=="true"){
    return json({...result,sms_status:"provider_disabled"});
  }
  const sid=env("TWILIO_ACCOUNT_SID"),secret=env("TWILIO_AUTH_TOKEN"),from=env("TWILIO_SMS_FROM");
  if(!sid||!secret||!toE164(from))return json({...result,sms_status:"provider_not_configured"});
  // The permanent dispatch claim MUST be committed before contacting Twilio:
  // network timeouts may be ambiguous, so never automatically retry.
  const service=env("SUPABASE_SERVICE_ROLE_KEY");
  if(!service)return json({...result,sms_status:"dispatch_unavailable"});
  const audit=createClient(supabaseUrl,service,{
    auth:{persistSession:false,autoRefreshToken:false}
  });
  const {data:claimed,error:claimError}=await audit.rpc("ed_claim_one_tracking_sms",{p_order_id:orderId});
  if(claimError)return json({...result,sms_status:"dispatch_unavailable"});
  if(claimed!==true)return json({...result,sms_status:"already_sent_or_attempted"});
  const form=new URLSearchParams();
  form.set("To",to);form.set("From",from);
  form.set("Body","Seguimiento de tu pedido #"+String(order.reference||"")+
   " de ESTAMBUL DELIVERY:\n"+track);
  let success=false,messageSid="",providerError="";
  try{
   const response=await fetch("https://api.twilio.com/2010-04-01/Accounts/"+
      encodeURIComponent(sid)+"/Messages.json",{
     method:"POST",
     headers:{"Authorization":"Basic "+btoa(sid+":"+secret),
      "Content-Type":"application/x-www-form-urlencoded"},
     body:form.toString()
   });
   const raw=await response.text();
   let data:Record<string,unknown>={};
   try{data=raw?JSON.parse(raw):{}}catch{}
   if(!response.ok){
    providerError="Twilio error "+response.status+" ("+String(data.code||"unknown")+")";
   }else{
    success=true;messageSid=String(data.sid||"");
   }
  }catch{
   providerError="Twilio connection error";
  }
  try{
    await audit.rpc("ed_finish_one_tracking_sms",{
      p_order_id:orderId,p_accepted:success,p_provider_sid:messageSid||null
    });
    await audit.rpc("ed_log_tracking_sms",{
      p_order_id:orderId,p_token:token,p_success:success,
      p_provider_sid:messageSid||null,p_error:providerError||null
    });
  }catch{/* The already-claimed attempt stays spent, avoiding a duplicate SMS. */}
  if(success)return json({...result,sms_status:"provider_accepted"});
  return json({...result,sms_status:"provider_rejected"});
 }catch{
  return json({error:"Error al aceptar el pedido o preparar su seguimiento"},503);
 }
});
