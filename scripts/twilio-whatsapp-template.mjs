#!/usr/bin/env node
/* Run locally with a NEW Twilio API key or rotated Auth Token in environment.
   NEVER put credentials in screenshots, terminal commands or this repository.
   This script creates/reviews a UTILITY template, but NEVER sends a message. */
const command=process.argv[2]||"help";
const account=process.env.TWILIO_ACCOUNT_SID||"";
const user=process.env.TWILIO_API_KEY||account;
const password=process.env.TWILIO_API_SECRET||process.env.TWILIO_AUTH_TOKEN||"";
const sid=process.env.TWILIO_WHATSAPP_CONTENT_SID||"";
const sidRegex=/^HX[0-9a-fA-F]{32}$/;
const previewUrl="https://shaniwaris80-crypto.github.io/ESTAMBUL-DELIVERY/track.html#token="+("a".repeat(64));
const template={
 friendly_name:"estambul_entrega_seguimiento_es",
 language:"es",
 variables:{"1":"EST-1028","2":previewUrl},
 types:{"twilio/text":{body:
  "🛵🥙 ESTAMBUL DELIVERY\nTu pedido {{1}} ha sido aceptado y pronto estará en camino.\n"+
  "Consulta el estado de tu entrega en este enlace privado: {{2}}\n"+
  "Puedes seguir el mismo enlace sin recibir más avisos. ¡Gracias por elegirnos!"
 }}
};
export {template,sidRegex};
async function api(path,method="GET",body){
 const auth=Buffer.from(user+":"+password).toString("base64");
 const response=await fetch("https://content.twilio.com"+path,{
  method,headers:{"Authorization":"Basic "+auth,...(body?{"Content-Type":"application/json"}:{})},
  body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)
 });
 const out=await response.json().catch(()=>({}));
 if(!response.ok){
  throw Error("Twilio respondió "+response.status+" (código "+(out.code||"sin especificar")+
    "). Revisa la cuenta y el SID. No se ha enviado ningún WhatsApp.");
 }
 return out;
}
async function run(){
 if(command==="help"){
  console.log("Comandos: node scripts/twilio-whatsapp-template.mjs create | approve | status");
  console.log("Usa variables de entorno privadas TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN (rotado),");
  console.log("o TWILIO_API_KEY y TWILIO_API_SECRET; para approve/status, TWILIO_WHATSAPP_CONTENT_SID.");
  return;
 }
 if(!/^AC[0-9a-fA-F]{32}$/.test(account)||!user||!password)
  throw Error("Credenciales no configuradas en variables de entorno. Nunca las pegues en GitHub.");
 if(command==="create"){
  const out=await api("/v1/Content","POST",template);
  if(!sidRegex.test(String(out.sid||"")))throw Error("Plantilla no devolvió un SID HX válido");
  console.log("Plantilla creada. Content SID: "+out.sid);
  console.log("Guárdalo como TWILIO_WHATSAPP_CONTENT_SID y solicita aprobación con approve.");
 }else if(command==="approve"){
  if(!sidRegex.test(sid))throw Error("Falta TWILIO_WHATSAPP_CONTENT_SID válido");
  const result=await api("/v1/Content/"+sid+"/ApprovalRequests/whatsapp","POST",
    {name:"estambul_entrega_seguimiento_es",category:"UTILITY"});
  console.log("Solicitud WhatsApp: "+String(result.status||"pendiente"));
 }else if(command==="status"){
  if(!sidRegex.test(sid))throw Error("Falta TWILIO_WHATSAPP_CONTENT_SID válido");
  const content=await api("/v1/Content/"+sid);
  if(content.account_sid!==account)throw Error("El Content SID pertenece a otra cuenta Twilio");
  const status=await api("/v1/Content/"+sid+"/ApprovalRequests");
  console.log("Plantilla: "+String(content.friendly_name||"sin nombre"));
  console.log("WhatsApp: "+String(status.whatsapp?.status||"sin aprobación"));
  console.log("Activa ED_WHATSAPP_AUTO_ENABLED únicamente tras ver 'approved' y validar el sender.");
 }else{
  throw Error("Comando desconocido");
 }
}
if(process.argv[1]?.endsWith("twilio-whatsapp-template.mjs")){
 run().catch(e=>{console.error(e.message);process.exitCode=1});
}
