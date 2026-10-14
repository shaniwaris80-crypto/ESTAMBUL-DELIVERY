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

let chatLoading=false;
function displayCustomerChat(lines){
 const parent=el("customerChatMessages");
 parent.replaceChildren();
 if(!Array.isArray(lines)||lines.length===0){const p=document.createElement("p");p.textContent="Todavía no hay mensajes.";parent.append(p);return;}
 for(const m of lines){
  const bubble=document.createElement("div");bubble.className="chat-bubble "+(m.role==="customer"?"mine":"theirs");
  const meta=document.createElement("small");meta.textContent=m.role==="customer"?"Tú":"Repartidor";
  const body=document.createElement("p");body.textContent=m.body||"";
  bubble.append(meta,body);parent.append(bubble);
 }
 parent.scrollTop=parent.scrollHeight;
}
async function refreshCustomerChat(){
 if(chatLoading||!current||!["asignado","recogido","en_ruta"].includes(current.status)||document.hidden)return;
 chatLoading=true;
 try{displayCustomerChat(await rpc("ed_customer_chat_history",{p_token:token}));el("customerChatError").hidden=true;}
 catch(e){el("customerChatError").textContent=e.message||"Chat no disponible";el("customerChatError").hidden=false;}
 finally{chatLoading=false;}
}

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
 el("connectionNotice").hidden=true;
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
 // El ETA es una aproximación de distancia/velocidad del servidor. Nunca se simula GPS.
 const eta=Number(data.eta_minutes);
 const canEstimate=data.status==="en_ruta"&&data.eta_minutes!=null&&Number.isFinite(eta)&&eta>=0;
 const state=String(data.gps_state||"");
 if(data.status==="entregado"){
  el("arrivalTitle").textContent="¡Pedido entregado!";
  el("arrivalDescription").textContent="La entrega ya está finalizada.";
 }else if(data.status==="cancelado"){
  el("arrivalTitle").textContent="Pedido cancelado";
  el("arrivalDescription").textContent="Llama al restaurante para cualquier consulta.";
 }else if(canEstimate){
  el("arrivalTitle").textContent="Unos "+Math.max(1,Math.round(eta))+" min";
  el("arrivalDescription").textContent="Llegada orientativa; se recalcula con el GPS más reciente. No incluye tráfico ni una ruta real por carretera.";
 }else if(data.status==="en_ruta"){
  el("arrivalTitle").textContent="Repartidor en camino";
  el("arrivalDescription").textContent=state==="not_shared"
    ?"El repartidor aún no ha activado la ubicación para este pedido."
    :state==="waiting_gps"
    ?"Esperando una señal GPS reciente del repartidor. Puede dejar de actualizarse si bloquea el móvil o usa otra app."
    :"Cuando haya GPS y coordenadas del destino podremos calcular el tiempo de llegada.";
 }else{
  el("arrivalTitle").textContent="Estamos preparando tu pedido";
  el("arrivalDescription").textContent="La estimación aparecerá cuando el repartidor esté en camino y comparta su ubicación.";
 }
 const details=canEstimate
  ?"Distancia aproximada: "+Number(data.eta_distance_km).toLocaleString("es-ES",{maximumFractionDigits:1})+
    " km · Velocidad "+(data.eta_speed_source==="gps"?"GPS":"urbana de referencia")+
    ": "+Math.round(Number(data.eta_speed_kmh))+" km/h"
  :"";
 el("arrivalDetails").textContent=details;
 el("arrivalDetails").hidden=!details;
 
 // Never draw historical or staff-only GPS: the server releases coordinates only with
 // a valid private tracking token, an active rider opt-in and a very recent position.
 const pos=data.status==="en_ruta"&&data.live_location&&typeof data.live_location==="object"?data.live_location:null;
 const lat=Number(pos?.lat),lng=Number(pos?.lng);
 const hasGps=Boolean(pos&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180);
 el("liveMapPanel").hidden=!hasGps;
 if(hasGps){
  const delta=0.004;
  const bbox=[lng-delta,lat-delta,lng+delta,lat+delta].join(",");
  const mapSrc="https://www.openstreetmap.org/export/embed.html?bbox="+encodeURIComponent(bbox)+
   "&layer=mapnik&marker="+encodeURIComponent(lat+","+lng);
  if(el("riderMap").dataset.position!==lat+","+lng){
   el("riderMap").src=mapSrc;
   el("riderMap").dataset.position=lat+","+lng;
  }
  el("openRiderMap").href="https://www.openstreetmap.org/?mlat="+encodeURIComponent(lat)+
   "&mlon="+encodeURIComponent(lng)+"#map=16/"+encodeURIComponent(lat)+"/"+encodeURIComponent(lng);
  el("riderMapTime").textContent="GPS actualizado: "+prettyTime(pos.updated_at);
 }else if(el("riderMap").getAttribute("src")){
  el("riderMap").removeAttribute("src");
  el("riderMap").removeAttribute("data-position");
 }
 // Show road-route details only when the backend returns validated, fresh route data.
 const route=data.status==="en_ruta"&&hasGps&&data.road_route;
 const routeKm=Number(route?.distance_km),routeEta=Number(route?.duration_minutes);
 const routeTime=Date.parse(String(route?.calculated_at||""));
 const routeValid=Boolean(route&&route.validated===true&&Number.isFinite(routeKm)&&routeKm>=0&&
  Number.isFinite(routeEta)&&routeEta>=0&&Number.isFinite(routeTime)&&
  Date.now()-routeTime>=0&&Date.now()-routeTime<120000);
 el("routePanel").hidden=!routeValid;
 if(routeValid){
  el("routeDescription").textContent="Recorrido estimado por carretera, actualizado con el GPS autorizado.";
  el("routeDistance").textContent=routeKm.toLocaleString("es-ES",{maximumFractionDigits:1})+
   " km restantes · "+Math.ceil(routeEta)+" min aproximados.";
 }
 el("customerChatPanel").hidden=!(["asignado","recogido","en_ruta"].includes(data.status));
 const telephone=typeof data.rider_call_phone==="string"&&/^\+[1-9]\d{7,14}$/.test(data.rider_call_phone)
   ?data.rider_call_phone:null;
 el("riderCallPanel").hidden=!telephone;
 if(telephone)el("callRiderLink").href="tel:"+telephone;
 else el("callRiderLink").removeAttribute("href");
 const delivered=data.status==="entregado";
 el("feedbackPanel").hidden=!delivered||!!data.feedback_sent;
 el("feedbackDone").hidden=!delivered||!data.feedback_sent;
 const review=data.review_url;
 const safeReview=typeof review==="string"&&/^https:\/\/(www\.)?(google\.(com|es|co\.uk)|g\.page|maps\.app\.goo\.gl)\//i.test(review);
 el("reviewPanel").hidden=!delivered||!safeReview;
 if(safeReview)el("reviewLink").href=review;
}
async function refresh(){
 if(polling)return;polling=true;
 try{
  const data=await rpc("ed_public_track",{p_token:token});
  if(!data){
   current=null;
   el("loading").hidden=true;
   el("orderContent").hidden=true;
   el("notFound").hidden=false;
   el("liveMapPanel").hidden=true;
   el("routePanel").hidden=true;
   el("riderMap").removeAttribute("src");
   el("riderMap").removeAttribute("data-position");
   el("connectionNotice").hidden=true;
   return;
  }
  draw(data);
  void refreshCustomerChat();
 }catch{
  if(!current){el("loading").hidden=true;el("orderContent").hidden=true;el("notFound").hidden=false;}
  else {
   el("updatedAt").textContent="Sin conexión · prueba a actualizar";
   el("connectionNotice").hidden=false;
   // A failed poll must not leave an old GPS marker or ETA looking live.
   el("liveMapPanel").hidden=true;
   el("riderMap").removeAttribute("src");
   el("riderMap").removeAttribute("data-position");
   el("arrivalTitle").textContent="Estimación no disponible";
   el("arrivalDescription").textContent="Sin conexión con el reparto. Consulta la última actualización arriba o vuelve a intentar."; 
   el("arrivalDetails").hidden=true;
  }
 }finally{polling=false;}
}
el("refreshButton").addEventListener("click",()=>void refresh());
el("customerChatForm").addEventListener("submit",async event=>{
 event.preventDefault();const message=el("customerChatText").value.trim();if(!message||!current)return;
 el("customerChatText").disabled=true;
 try{
  await rpc("ed_customer_chat_send",{p_token:token,p_body:message});
  el("customerChatText").value="";await refreshCustomerChat();
 }catch(err){el("customerChatError").textContent=err.message||"Error de chat";el("customerChatError").hidden=false;}
 finally{el("customerChatText").disabled=false;}
});
setInterval(()=>{if(current)void refreshCustomerChat();},7000);

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
 setInterval(()=>{if(document.visibilityState==="visible")void refresh();},7000);
}
})();