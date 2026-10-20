import twilio from "npm:twilio@6.2.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}
});
const env=(key:string)=>Deno.env.get(key)||"";
const validStatuses=new Set(["queued","sending","sent","delivered","undelivered","failed"]);
const twilioValidator=twilio as unknown as {
  validateRequest:(authToken:string,signature:string,url:string,params:Record<string,string>)=>boolean
};

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const type=req.headers.get("content-type")||"";
  if(!type.toLowerCase().startsWith("application/x-www-form-urlencoded"))
    return json({error:"Unsupported content type"},415);

  const authToken=env("TWILIO_AUTH_TOKEN");
  const callbackUrl=env("TWILIO_STATUS_CALLBACK_URL");
  const supabaseUrl=env("SUPABASE_URL");
  const serviceKey=env("SUPABASE_SERVICE_ROLE_KEY");
  if(!authToken||!callbackUrl||!supabaseUrl||!serviceKey)
    return json({error:"Status callback is not configured"},503);
  let configuredUrl:URL;
  try{configuredUrl=new URL(callbackUrl);}catch{return json({error:"Invalid callback URL"},503);}
  if(configuredUrl.protocol!=="https:"||configuredUrl.username||configuredUrl.password||
    !configuredUrl.pathname.endsWith("/functions/v1/ed-twilio-status")||
    configuredUrl.search||configuredUrl.hash)
    return json({error:"Invalid callback URL"},503);

  const signature=req.headers.get("x-twilio-signature")||"";
  if(!signature)return json({error:"Invalid signature"},403);
  let params:Record<string,string>={};
  try{
    const form=new URLSearchParams(await req.text());
    for(const [name,value] of form.entries()){
      if(Object.prototype.hasOwnProperty.call(params,name))
        return json({error:"Duplicate callback parameter"},400);
      params[name]=value;
    }
  }catch{return json({error:"Invalid callback body"},400);}

  let valid=false;
  try{valid=twilioValidator.validateRequest(authToken,signature,callbackUrl,params);}
  catch{return json({error:"Invalid signature"},403);}
  if(!valid)return json({error:"Invalid signature"},403);

  const sid=params.MessageSid||params.SmsSid||"";
  const status=(params.MessageStatus||params.SmsStatus||"").toLowerCase();
  const errorCode=params.ErrorCode||"";
  if(!/^SM[0-9a-fA-F]{32}$/.test(sid)||!validStatuses.has(status))
    return json({error:"Invalid message status"},400);

  try{
    const service=createClient(supabaseUrl,serviceKey,{
      auth:{persistSession:false,autoRefreshToken:false}
    });
    const {data,error}=await service.rpc("ed_update_tracking_sms_status",{
      p_provider_sid:sid,p_status:status,
      p_error:errorCode?("Twilio error "+errorCode):null
    });
    if(error||data!==true)return json({error:"Status could not be recorded"},503);
    return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});
  }catch{
    return json({error:"Status could not be recorded"},503);
  }
});
