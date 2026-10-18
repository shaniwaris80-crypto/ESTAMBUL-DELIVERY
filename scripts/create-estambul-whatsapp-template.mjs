#!/usr/bin/env node
/**
 * Estambul Delivery — create a Twilio Content API WhatsApp template.
 * No passwords are stored, printed or committed.
 *
 * Required env in YOUR OWN terminal (not ChatGPT):
 *   TWILIO_ACCOUNT_SID=AC...
 *   TWILIO_AUTH_TOKEN=...        (or TWILIO_API_KEY and TWILIO_API_SECRET)
 *
 *   node scripts/create-estambul-whatsapp-template.mjs create
 *   node scripts/create-estambul-whatsapp-template.mjs verify HX...
 *   node scripts/create-estambul-whatsapp-template.mjs approve HX...
 *
 * "create" only creates a template; "approve" submits it for Meta review.
 * Neither action sends a message or affects current customers.
 */
import {pathToFileURL} from "node:url";
const operation=process.argv[2]||"help";
const contentSid=process.argv[3]||"";
const sid=process.env.TWILIO_ACCOUNT_SID?.trim()||"";
const key=process.env.TWILIO_API_KEY?.trim()||sid;
const secret=process.env.TWILIO_API_SECRET||process.env.TWILIO_AUTH_TOKEN||"";
const isHx=s=>/^HX[0-9a-fA-F]{32}$/.test(s);
const isAc=s=>/^AC[0-9a-fA-F]{32}$/.test(s);
const sample="https://shaniwaris80-crypto.github.io/ESTAMBUL-DELIVERY/track.html#token="+("a".repeat(64));
export const template={
 friendly_name:"estambul_delivery_tracking_es_v1",
 language:"es",
 variables:{"1":"ED-1025","2":sample},
 types:{"twilio/text":{body:"🛵🥙 ESTAMBUL DELIVERY: tu pedido {{1}} ha sido aceptado. Consulta su seguimiento privado aquí: {{2}}. Puedes ver los cambios de estado en el mismo enlace. Gracias por tu pedido."}}
};
export const approval={name:"estambul_delivery_tracking_es_v1",category:"UTILITY"};
async function api(path,method="GET",body){
 const res=await fetch("https://content.twilio.com/v1"+path,{
  method,
  headers:{
   Authorization:"Basic "+Buffer.from(key+":"+secret).toString("base64"),
   ...(body?{"Content-Type":"application/json"}:{})
  },
  ...(body?{body:JSON.stringify(body)}:{})
 });
 const payload=await res.json().catch(()=>({}));
 if(!res.ok)throw new Error("Twilio "+res.status+" (code "+String(payload?.code??"unknown")+") — "+String(payload?.message||"consulta la consola"));
 return payload;
}
async function main(){
 if(operation==="help"){
  console.log("Crear plantilla: node scripts/create-estambul-whatsapp-template.mjs create");
  console.log("Verificar cuenta y estado: node scripts/create-estambul-whatsapp-template.mjs verify HX...");
  console.log("Solicitar aprobación: node scripts/create-estambul-whatsapp-template.mjs approve HX...");
  return;
 }
 if(!isAc(sid)||!secret||!key)throw new Error("Faltan las credenciales locales de la cuenta Twilio. No las pegues en ChatGPT ni en GitHub.");
 if(operation==="create"){
  const data=await api("/Content","POST",template);
  if(!isHx(data.sid))throw new Error("Twilio no devolvió un SID HX válido");
  if(data.account_sid!==sid)throw new Error("La plantilla pertenece a otra cuenta: revisa la subcuenta Twilio");
  console.log("Plantilla creada en TU cuenta. Content SID:",data.sid);
  console.log("No está aprobada todavía. Revisa y solicita aprobación antes de usarla.");
  return;
 }
 if(!isHx(contentSid))throw new Error("Introduce un Content SID HX de 34 caracteres");
 const content=await api("/Content/"+encodeURIComponent(contentSid));
 if(content.account_sid!==sid)throw new Error("21655: la plantilla NO pertenece a la cuenta configurada para enviar.");
 if(operation==="verify"){
  const status=await api("/Content/"+encodeURIComponent(contentSid)+"/ApprovalRequests");
  console.log(JSON.stringify({
   content_sid:content.sid,account_matches:true,friendly_name:content.friendly_name,
   whatsapp_status:status.whatsapp?.status||"unsubmitted",rejection_reason:status.whatsapp?.rejection_reason||null
  },null,2));
  return;
 }
 if(operation==="approve"){
  const status=await api("/Content/"+encodeURIComponent(contentSid)+"/ApprovalRequests","POST",approval);
  console.log("Plantilla enviada a revisión de WhatsApp:",contentSid);
  console.log("Estado de solicitud:",status.status||"desconocido");
  console.log("No actives envíos a clientes hasta obtener estado approved.");
  return;
 }
 throw new Error("Acción no admitida. Utiliza create, verify o approve");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main().catch(err=>{console.error(String(err.message));process.exitCode=1;});
}
