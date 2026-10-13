(()=>{
"use strict";
const root=window.ESTAMBUL_SUPABASE||{},base=String(root.url||"").replace(/\/+$/,""),key=root.anonKey||"";
const el=id=>document.getElementById(id);
const token=new URLSearchParams(location.hash.replace(/^#/,"")).get("token");
const labels={pendiente:"Recibido",asignado:"Asignado",recogido:"Recogido",en_ruta:"En camino",entregado:"Entregado",cancelado:"Cancelado"};
const steps=[
 {status:"pendiente",title:"Pedido recibido",info:"El restaurante ha recibido la solicitud."},
 {status:"asignado",title:"Repartidor asignado",info:"Tu pedido está en preparación para el reparto."},
 {status:"recogido",title:"Pedido recogido",info:"El repartidor ya tiene el pedido."},
 {status:"en_ruta",title:"En camino",info:"Tu pedido está de camino."},
 {status:"entregado",title:"Entregado",info:"El repartidor ha finalizado la entrega."}
];
let current=null,polling=false;
function prettyTime(value){
 if(!value)return"";
 const date=new Date(value);return Number.isNaN(date.getTime())?"":date.toLocaleString("es-ES",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
}
async function rpc(name,body){
 const response=await fetch(base+"/rest/v1/rpc/"+name,{method:"POST",headers:{"apikey":key,"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store",referrerPolicy:"no-referrer"});
 const txt=await response.text();let data;try{data=txt?JSON.parse(txt):null;}catch{data=null;}
 if(!response.ok)throw Error(data?.message||"Servicio no disponible.");
 return data;
}
function applyBrand(data){
 const color=/^#[0-9a-fA-F]{6}$/.test(data.color||"")?data.color:"#14263b";
 document.documentElement.style.setProperty("--brand",color);
 el("brandTitle").textContent=data.brand||"ESTAMBUL DELIVERY";
 document.title="Pedido "+data.reference+" · "+(data.brand||"ESTAMBUL DELIVERY");
 if(data.logo_url&&/^https:\/\//i.test(data.logo_url)){
  el("brandLogo").src=data.logo_url;el("brandLogo").hidden=false;el("brandIcon").hidden=true;
  el("brandLogo").onerror=()=>{el("brandLogo").hidden=true;el("brandIcon").hidden=false;};
 }
}
function draw(data){
 current=data;el("loading").hidden=true;el("notFound").hidden=false;el("orderContent").hidden=false;
 applyBrand(data);el("orderRef").textContent="Pedido #"+data.reference;
 const index=steps.findIndex(s=>s.status===data.status);
 el("liveStatus").textContent=labels[data.status]||"Actualización";
 el("liveStatus").classList.toggle("cancel",data.status==="cancelado");
 el("orderDescription").textContent=data.status==="cancelado"?"El pedido ha sido cancelado. Contacta con el restaurante si tienes dudas.":"Aquí puedes consultar el estado de tu entrega, actualizado por el restaurante y el repartidor.";
 el("progressBar").style.width=(data.status==="cancelado"?0:(Math.max(0,index)+1)/steps.length*100)+"%";
 el("steps").innerHTML="";
 steps.forEach((item,i)=>{
  const li=document.createElement("div");li.className="step "+(data.status!=="cancelado"&&i<index?"past":data.status!=="cancelado"&&i===index?"current":"");
  const num=document.createElement("span");num.className="step-number";num.textContent=data.status!=="cancelado"&&i<=index?"✓":String(i+1);
  const copy=document.createElement("div"),heading=document.createElement("strong"),hint=document.createElement("p");
  heading.textContent=item.title;hint.textContent=item.info;copy.append(heading,hint);li.append(num,copy);el("steps").append(li);
 });
 el("updatedAt").textContent="Último cambio: "+prettyTime(data.updated_at);
 const delivered=data.status==="entregado";
 el("feedbackPanel").hidden=!delivered||!!data.feedback_sent;
 el("feedbackDone").hidden=!delivered||!data.feedback_sent;
 const review=data.review_url;
 const safeReview=typeof review==="string"&&/^https:\/\/(www\.)?(google\.[a-z.]+|g\.page|maps\.app\.goo\.gl)\//i.test(review);
 el("reviewPanel").hidden=!delivered||!safeReview;
 if(safeReview)el("reviewLink").href=review;
}
async function refresh(){
 if(polling)return;polling=true;
 try{
  const data=await rpc("ed_public_track",{p_token:token});
  if(!data){el("loading").hidden=true;el("orderContent").hidden=true;el("notFound").hidden=false;return;}
  draw(data);
 }catch{
  if(!current){el("loading").hidden=true;el("orderContent").hidden=true;el("notFound").hidden=false;}
  else el("updatedAt").textContent="Sin conexión · prueba a actualizar";
 }finally{polling=false;}
}
el("refreshButton").addEventListener("click",()=>void refresh());
el("feedbackForm").addEventListener("submit",async e=>{
 e.preventDefault();const chosen=document.querySelector('input[name="rating"]:checked');
 if(!chosen){el("feedbackError").hidden=false;el("feedbackError").textContent="Selecciona de 1 a 5 estrellas.";return;}
 el("submitFeedback").disabled=true;el("feedbackError").hidden=true;
 try{
  await rpc("ed_submit_feedback",{p_token:token,p_rating:Number(chosen.value),p_comment:el("feedbackComment").value.trim()});
  await refresh();
 }catch(error){el("feedbackError").hidden=false;el("feedbackError").textContent=error.message||"Inténtalo de nuevo.";}
 finally{el("submitFeedback").disabled=false;}
});
if(!token||!/^[a-f0-9]{64}$/.test(token)||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)||!key){
 el("loading").hidden=true;el("notFound").hidden=false;
}else{
 void refresh();
 setInterval(()=>{if(document.visibilityState==="visible")void refresh();},15000);
}
})();