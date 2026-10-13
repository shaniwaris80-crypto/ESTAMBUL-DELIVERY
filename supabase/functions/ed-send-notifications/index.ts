import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const textHeaders={"Content-Type":"application/json","Cache-Control":"no-store"};
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:textHeaders});
const env=(name:string)=>Deno.env.get(name)||"";
const formats=new Set(["asignado","recogido","en_ruta","entregado","cancelado"]);
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const service=env("SUPABASE_SERVICE_ROLE_KEY");
 if(!service||req.headers.get("Authorization")!=="Bearer "+service)return json({error:"Unauthorized"},401);
 if(env("ESTAMBUL_MESSAGING_ENABLED")!=="true"){
  return json({enabled:false,processed:0,reason:"Sender disabled. Configure approved sender and opt-in first."});
 }
 const url=env("SUPABASE_URL"),sid=env("TWILIO_ACCOUNT_SID"),auth=env("TWILIO_AUTH_TOKEN");
 const smsFrom=env("TWILIO_SMS_FROM"),whatsappFrom=env("TWILIO_WHATSAPP_FROM");
 if(!url||!sid||!auth||(!smsFrom&&!whatsappFrom))return json({error:"Missing sender configuration"},503);
 const supabase=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:queued,error:claimErr}=await supabase.rpc("ed_claim_notifications",{p_limit:8});
 if(claimErr)return json({error:"Unable to claim queue"},503);
 const jobs=Array.isArray(queued)?queued:[];
 const result={claimed:jobs.length,accepted:0,failed:0};
 for(const item of jobs){
  const id=String(item.id||"");
  let ok=false,providerId="",errorMessage="";
  try{
   const channel=String(item.channel||""),to=String(item.to||"");
   const status=String(item.status||""),ref=String(item.reference||"");
   if(!/^\+[1-9]\d{7,14}$/.test(to))throw Error("Recipient phone must be E.164");
   if(!formats.has(status))throw Error("Unsupported status");
   const form=new URLSearchParams();
   if(channel==="sms"){
     if(!/^\+[1-9]\d{7,14}$/.test(smsFrom))throw Error("SMS sender not configured");
     form.set("To",to);form.set("From",smsFrom);form.set("Body",String(item.body||"").slice(0,420));
   }else if(channel==="whatsapp"){
     // Approved WhatsApp Content Templates are required for business-initiated notices.
     const template=env("TWILIO_WA_TEMPLATE_"+status.toUpperCase());
     if(!/^HX[a-fA-F0-9]{32}$/.test(template))throw Error("Approved template missing for "+status);
     if(!/^\+[1-9]\d{7,14}$/.test(whatsappFrom))throw Error("WhatsApp sender not configured");
     form.set("To","whatsapp:"+to);
     form.set("From","whatsapp:"+whatsappFrom);
     form.set("ContentSid",template);
     form.set("ContentVariables",JSON.stringify({"1":ref}));
   }else throw Error("Unknown channel");
   const response=await fetch("https://api.twilio.com/2010-04-01/Accounts/"+encodeURIComponent(sid)+"/Messages.json",{
     method:"POST",
     headers:{"Authorization":"Basic "+btoa(sid+":"+auth),"Content-Type":"application/x-www-form-urlencoded"},
     body:form.toString()
   });
   const raw=await response.text();let data:Record<string,unknown>={};
   try{data=JSON.parse(raw)}catch{}
   if(!response.ok)throw Error("Provider rejected message ("+response.status+"), code "+String(data.code||"unknown"));
   providerId=String(data.sid||"");
   ok=true;result.accepted++;
  }catch(e){errorMessage=e instanceof Error?e.message:"Sending error";result.failed++;}
  await supabase.rpc("ed_finish_notification",{
   p_id:id,p_ok:ok,p_provider_id:providerId||null,p_error:ok?null:errorMessage
  });
 }
 return json({enabled:true,...result,note:"accepted indicates provider acceptance, not delivery confirmation"});
});