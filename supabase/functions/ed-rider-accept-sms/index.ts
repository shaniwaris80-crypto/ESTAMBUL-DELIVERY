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
   const whatsappFrom=env("TWILIO_WHATSAPP_FROM");
   const whatsappSid=env("TWILIO_WHATSAPP_CONTENT_SID");
   const whatsappReady=env("ED_WHATSAPP_AUTO_ENABLED")==="true"&&
      Boolean(env("TWILIO_ACCOUNT_SID")&&env("TWILIO_AUTH_TOKEN")&&service)&&
      /^whatsapp:\+[1-9]\d{7,14}$/.test(whatsappFrom)&&/^HX[0-9a-fA-F]{32}$/.test(whatsappSid);
   return json({whatsapp:{configured:whatsappReady,
      reason:!env("TWILIO_WHATSAPP_CONTENT_SID")?"template_missing":
       env("ED_WHATSAPP_AUTO_ENABLED")!=="true"?"disabled":
       !whatsappReady?"provider_not_configured":"configuration_present_approval_not_verified"},
    ready:enabled&&configuredProvider&&service,
    reason:!enabled?"disabled":!configuredProvider?"provider_not_configured":!service?"dispatch_unavailable":"configured",
    note:"Configuración verificada; recepción del SMS no comprobada."});
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
  const channel=order.notification_channel==="whatsapp"?"whatsapp":"sms";
  if(!order.notifications_consent||
     !["sms","whatsapp"].includes(String(order.notification_channel||""))){
    return json({...result,sms_status:"sms_not_authorized"});
  }
  const to=toE164(order.customer_phone);
  if(!to)return json({...result,sms_status:"invalid_phone"});
  if(channel==="sms"&&env("ESTAMBUL_MESSAGING_ENABLED")!=="true"){
    return json({...result,sms_status:"provider_disabled"});
  }
  if(channel==="whatsapp"&&env("ED_WHATSAPP_AUTO_ENABLED")!=="true"){
    return json({...result,sms_status:"whatsapp_manual_only",channel});
  }
  const sid=env("TWILIO_ACCOUNT_SID"),secret=env("TWILIO_AUTH_TOKEN");
  const from=channel==="whatsapp"?env("TWILIO_WHATSAPP_FROM"):env("TWILIO_SMS_FROM");
  const contentSid=env("TWILIO_WHATSAPP_CONTENT_SID");
  if(!sid||!secret||channel==="sms"&&!toE164(from))
    return json({...result,sms_status:"provider_not_configured",channel});
  if(channel==="whatsapp"&&(!/^whatsapp:\+[1-9]\d{7,14}$/.test(from)||
      !/^HX[0-9a-fA-F]{32}$/.test(contentSid))){
    return json({...result,sms_status:"whatsapp_not_configured",channel});
  }
  // Catch the exact Twilio 21655 class (missing/wrong-account Content SID)
  // BEFORE spending the permanent attempt claim. Also require WhatsApp approval.
  if(channel==="whatsapp"){
    const authorization="Basic "+btoa(sid+":"+secret);
    try{
      const template=await fetch("https://content.twilio.com/v1/Content/"+contentSid,{
        headers:{Authorization:authorization},signal:AbortSignal.timeout(6000)
      });
      if(!template.ok)return json({...result,sms_status:"whatsapp_template_not_found",channel});
      const details=await template.json() as {account_sid?:string};
      if(details.account_sid&&details.account_sid!==sid)
        return json({...result,sms_status:"whatsapp_template_not_found",channel});
      const approval=await fetch("https://content.twilio.com/v1/Content/"+contentSid+
        "/ApprovalRequests",{headers:{Authorization:authorization},signal:AbortSignal.timeout(6000)});
      if(!approval.ok)return json({...result,sms_status:"whatsapp_approval_unverified",channel});
      const approvalData=await approval.json() as {whatsapp?:{status?:string}};
      if(approvalData.whatsapp?.status!=="approved")
        return json({...result,sms_status:"whatsapp_template_unapproved",channel});
    }catch{return json({...result,sms_status:"whatsapp_approval_unverified",channel});}
  }
  // The permanent dispatch claim MUST be committed before contacting Twilio:
  // network timeouts may be ambiguous, so never automatically retry.
  const service=env("SUPABASE_SERVICE_ROLE_KEY");
  if(!service)return json({...result,sms_status:"dispatch_unavailable"});
  const audit=createClient(supabaseUrl,service,{
    auth:{persistSession:false,autoRefreshToken:false}
  });
  const {data:claimed,error:claimError}=channel==="whatsapp"
    ?await audit.rpc("ed_claim_one_tracking_message",{p_order_id:orderId,p_channel:channel})
    :await audit.rpc("ed_claim_one_tracking_sms",{p_order_id:orderId});
  if(claimError)return json({...result,sms_status:"dispatch_unavailable"});
  if(claimed!==true)return json({...result,sms_status:"already_sent_or_attempted"});
  const form=new URLSearchParams();
  form.set("To",channel==="whatsapp"?"whatsapp:"+to:to);form.set("From",from);
  if(channel==="whatsapp"){
    form.set("ContentSid",contentSid);
    form.set("ContentVariables",JSON.stringify({"1":String(order.reference||"Pedido").slice(0,100),
      "2":track}));
  }else{
    form.set("Body","Seguimiento de tu pedido #"+String(order.reference||"")+
      " de ESTAMBUL DELIVERY:\n"+track);
  }
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
    // Keep legacy SMS receipts as SMS only. WhatsApp is recorded in the shared
    // once-per-order dispatch table with channel and Twilio message SID.
    if(channel==="sms")await audit.rpc("ed_log_tracking_sms",{
      p_order_id:orderId,p_token:token,p_success:success,
      p_provider_sid:messageSid||null,p_error:providerError||null
    });
  }catch{/* The already-claimed attempt stays spent, avoiding a duplicate SMS. */}
  if(success)return json({...result,sms_status:channel==="whatsapp"?
    "whatsapp_provider_accepted":"provider_accepted",channel});
  return json({...result,sms_status:channel==="whatsapp"?
    "whatsapp_provider_rejected":"provider_rejected",channel});
 }catch{
  return json({error:"Error al aceptar el pedido o preparar su seguimiento"},503);
 }
});
