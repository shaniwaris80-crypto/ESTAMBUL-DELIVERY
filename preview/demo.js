/* PARITY PREVIEW — this file uses the real production HTML, CSS and renderers.
   It contains ONLY hardcoded sample data. No Supabase, LastPOS, Twilio, GPS or storage. */
(()=>{
 "use strict";
 const screen=document.body.dataset.demoScreen;
 const $=id=>document.getElementById(id);
 const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const now=()=>new Date().toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"});
 const banner=document.createElement("aside");
 banner.className="parity-banner";
 banner.innerHTML='<span class="parity-stamp">DEMO · DATOS FICTICIOS</span><span class="parity-explainer">Misma estructura y CSS que producción · no envía mensajes ni guarda pedidos</span>'+
 '<nav aria-label="Previsualizaciones"><a href="backoffice.html">Backoffice</a><a href="rider.html">Rider</a><a href="cliente.html">Cliente</a></nav>';
 document.body.prepend(banner);
 document.body.classList.add("parity-mode");
 document.addEventListener("click",e=>{
  const a=e.target.closest("a[href]");
  if(a&&(/^(https?:|tel:|sms:|mailto:)/i.test(a.getAttribute("href")))){
   e.preventDefault();notice("En esta simulación no se abren servicios externos ni llamadas.");
  }
 },true);
 document.addEventListener("submit",e=>{
  if(!e.target.closest("#demoControls"))e.preventDefault();
 },true);
 function notice(msg){
  let p=$("parityNotice");
  if(!p){p=document.createElement("div");p.id="parityNotice";p.className="parity-toast";p.setAttribute("role","status");document.body.append(p);}
  p.textContent=msg;
 }
 if(screen==="backoffice")previewBackoffice();
 if(screen==="rider")previewRider();
 if(screen==="cliente")previewClient();
 function previewBackoffice(){
  const el=$;
  const labels={pendiente:"Pendiente",asignado:"Asignado",recogido:"Recogido",en_ruta:"En reparto",entregado:"Entregado",cancelado:"Cancelado"};
  const next={asignado:"recogido",recogido:"en_ruta",en_ruta:"entregado"};
  const chan={test:"Prueba",lastapp:"Last.app",uber:"Uber Eats",justeat:"Just Eat"};
  const normalizeOps=v=>String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("es-ES").trim();
  let opsQuery="",opsFocus="all",opsChannel="all",showArchivedOrders=false,lastReloadAt=Date.now();
  const member={role:"admin",account_id:"demo-account"},account={name:"ESTAMBUL DELIVERY"};
  let operationsEpoch=null,operationsResetReady=true;
  let archivedOrderIds=new Set(), locationShares=new Map(),shiftClosures=[],shiftClosureItems=[];
  let customerFeedback=[],riderPositions=[],brandDetails=null;
  const riders=Array.from({length:5},(_,i)=>({id:"demo-rider-"+(i+1),display_name:"Rider 0"+(i+1),user_id:i===0?"demo-auth":null,active:true,online:i===0,customer_call_enabled:false,phone:null}));
  let orders=[
   {id:"d101",reference:"LA-DEMO-101",channel:"lastapp",customer_name:"Cliente ficticio A",destination:"Dirección de ejemplo · Burgos",status:"pendiente",amount:18.50,rider_id:null,payment_method:null,notes:"Pedido de demostración",notifications_consent:false,notification_channel:"none"},
   {id:"d102",reference:"LA-DEMO-102",channel:"lastapp",customer_name:"Cliente ficticio B",destination:"Calle de prueba · Burgos",status:"en_ruta",amount:26.50,rider_id:"demo-rider-1",payment_method:"efectivo",notes:"Dos pizzas y una bebida (ficticias)",notifications_consent:true,notification_channel:"sms"},
   {id:"d103",reference:"PRUEBA-103",channel:"test",customer_name:"Cliente simulado C",destination:"Ejemplo 3 · Burgos",status:"asignado",amount:14.95,rider_id:"demo-rider-1",payment_method:"tarjeta",notes:"Sin datos reales",notifications_consent:false,notification_channel:"none"},
   {id:"d104",reference:"LA-DEMO-104",channel:"lastapp",customer_name:"Cliente ficticio D",destination:"Ejemplo 4 · Burgos",status:"entregado",amount:21.00,rider_id:"demo-rider-1",payment_method:null,notes:"Falta conciliar",notifications_consent:false,notification_channel:"none"}
  ];
  function matchOperations(o){
   if(opsChannel!=="all"&&o.channel!==opsChannel)return false;
   if(opsQuery&&![o.reference,o.customer_name,o.destination,o.channel,o.notes].map(normalizeOps).join(" ").includes(opsQuery))return false;
   switch(opsFocus){
    case "unassigned":return !o.rider_id&&o.channel!=="test"&&!["entregado","cancelado"].includes(o.status);
    case "route":return o.status==="en_ruta";
    case "active":return !["entregado","cancelado"].includes(o.status);
    case "payment_missing":return o.status==="entregado"&&!o.payment_method;
    case "sms_off":return !o.notifications_consent;
    case "gps_shared":return locationShares.get(o.id)===true;
    case "delivered":return o.status==="entregado";
    default:return true;
   }
  }
  const mapsLink=()=>"",whatsappNumber=()=>null;
  function renderBrand(){if(el("brandName"))el("brandName").value="ESTAMBUL DELIVERY";}
  function renderFeedback(){el("feedbackCount").textContent="0 valoraciones";el("feedbackList").textContent="Sin valoraciones ficticias.";}
  function renderGpsPositions(){el("gpsAdminCount").textContent="0 compartiendo";el("gpsRiderList").textContent="GPS desactivado en la simulación.";}
  function drawShiftHistory(){el("shiftHistoryCount").textContent="0 cierres";el("shiftHistory").textContent="Sin arqueos ficticios.";}
function render(){
 const staff=member.role!=="rider",open=orders.filter(o=>!["entregado","cancelado"].includes(o.status));
 const archivedIds=archivedOrderIds;
 const allVisibleOrders=showArchivedOrders?orders:orders.filter(o=>!archivedIds.has(o.id));
 const visibleOrders=staff?allVisibleOrders.filter(matchOperations):allVisibleOrders;
 const stats=[["Pedidos visibles",staff?visibleOrders.length:orders.length],["Sin asignar",open.filter(o=>!o.rider_id).length],["En ruta",open.filter(o=>o.status==="en_ruta").length],[staff?"Riders":"Mis pendientes",staff?riders.filter(r=>r.active).length:open.length]];
 el("stats").innerHTML=stats.map(x=>'<div class="stat"><small>'+esc(x[0])+'</small><b>'+x[1]+'</b><small>En esta cuenta</small></div>').join("");
 el("lastSync").textContent=lastReloadAt?"Datos recibidos a las "+new Date(lastReloadAt).toLocaleTimeString("es-ES")+" · Acceso limitado por usuario (RLS)":"Esperando sincronización…";
 if(staff){
  // Read-only operational summary: NEVER assigns Last.app couriers.
  el("proAvailableRiders").textContent=String(riders.filter(r=>r.active&&r.online&&r.user_id).length);
  el("proWaitingOrders").textContent=String(open.filter(o=>o.channel!=="test"&&o.status!=="en_ruta").length);
  el("proSyncLabel").textContent=lastReloadAt?new Date(lastReloadAt).toLocaleTimeString("es-ES"):"Esperando…";
  const rosterSlots=Array.from({length:5},(_,i)=>{
   const n=i+1;
   const rider=riders.find(r=>new RegExp("^rider[\\s_-]*0?"+n+"$","i").test(String(r.display_name||"").trim()));
   return {n,rider,ready:Boolean(rider?.active&&rider?.user_id)};
  });
  el("riderCount").textContent=rosterSlots.filter(s=>s.ready).length+" de 5 listos";
  el("riderCapacity").innerHTML=rosterSlots.map(s=>
   '<div class="rider-slot '+(s.ready?'ready':'waiting')+'"><span class="rider-slot-number">'+String(s.n).padStart(2,"0")+'</span>'+
   '<strong>RIDER '+String(s.n).padStart(2,"0")+'</strong>'+
   '<small>'+(s.ready?(s.rider.online?'● Cuenta activa · Online':'● Cuenta activa · Offline'):
    s.rider?'Pendiente de activación':'Sin cuenta creada')+'</small></div>').join("");
  el("orderCount").textContent=visibleOrders.length+" de "+allVisibleOrders.length+" pedidos";
  el("opsResultCount").textContent=visibleOrders.length+" resultados de "+allVisibleOrders.length+
    (opsFocus!=="all"||opsQuery||opsChannel!=="all"?" · Filtros activos":"")+" · "+archivedIds.size+" en arqueos cerrados";
  const openOrders=allVisibleOrders.filter(o=>!["entregado","cancelado"].includes(o.status));
  el("opsUnassignedCount").textContent=openOrders.filter(o=>!o.rider_id&&o.channel!=="test").length;
  el("opsRouteCount").textContent=openOrders.filter(o=>o.status==="en_ruta").length;
  el("opsPaymentCount").textContent=allVisibleOrders.filter(o=>o.status==="entregado"&&!["efectivo","tarjeta"].includes(o.payment_method)).length;
  document.querySelectorAll("[data-ops-focus]").forEach(b=>{
    b.setAttribute("aria-pressed",String(b.dataset.opsFocus===opsFocus));
  });
  renderBrand();renderFeedback();renderGpsPositions();
  drawShiftHistory();
  el("riders").innerHTML=riders.map(r=>'<div class="rider-item"><span class="avatar">'+esc(r.display_name.slice(0,2).toUpperCase())+'</span><span class="rider-meta"><strong>'+esc(r.display_name)+'</strong><small>'+(r.active?(r.online?"● Online":"○ Desconectado"):"Inactivo")+' · '+open.filter(o=>o.rider_id===r.id).length+' pedidos</small><small>'+(r.customer_call_enabled&&r.phone?"☎ Clientes pueden llamar al número de trabajo":"Llamadas de clientes desactivadas")+'</small></span>'+
 '<button type="button" class="outline rider-call-config" data-rider-phone="'+esc(r.id)+'">Configurar llamadas</button></div>').join("")||"<p>Sin riders</p>";
  el("ordersTable").innerHTML=visibleOrders.map(o=>{
    const options='<option value="">Sin asignar</option>'+riders.filter(r=>r.active).map(r=>'<option value="'+esc(r.id)+'" '+(o.rider_id===r.id?"selected":"")+'>'+esc(r.display_name)+'</option>').join("");
    const gmaps=mapsLink(o);
    const foundCode=String(o.notes||"").match(/(?:^|\s|\|)Last\.app\s*#\s*([A-Za-z0-9_-]{1,32})/i);
    const visibleRef=foundCode?foundCode[1]:o.reference;
    return '<tr><td><strong>'+esc(visibleRef)+'</strong>'+(foundCode?'<small class="ops-full-ref">Last.app: '+esc(o.reference)+'</small>':'')+'<small>'+esc(Number(o.amount||0).toFixed(2))+' €</small></td>'+
      '<td><strong>'+esc(o.customer_name)+'</strong><small>'+esc(o.destination)+'</small>'+
      (o.customer_phone?'<small>☎ '+esc(o.customer_phone)+'</small>':'')+
      (o.customer_phone?'<small class="ops-sms '+(o.notifications_consent&&o.notification_channel==="sms"?"ready":"off")+'">'+
       (o.notifications_consent&&o.notification_channel==="sms"?"✉ SMS habilitado (entrega no confirmada)":"✉ SMS no habilitado")+'</small>':'')+
      (locationShares.get(o.id)?'<small class="ops-map-status">📍 Enlace GPS compartido (posición no verificada)</small>':'')+
      (o.notes?'<small>📝 '+esc(o.notes)+'</small>':'')+
      (gmaps?'<small><a href="'+gmaps+'" target="_blank" rel="noopener noreferrer">📍 Google Maps ↗</a></small>':'')+
      '</td><td>'+esc(chan[o.channel]||o.channel)+'</td><td><strong>'+esc(o.payment_method==='efectivo'?'💶 Efectivo':o.payment_method==='tarjeta'?'💳 Tarjeta':'Por indicar')+'</strong></td><td><span class="pill state-'+esc(o.status)+'">'+esc(labels[o.status])+
      '</span></td><td>'+(o.channel!=="test"
       ?'<strong class="last-manual">Gestionar en Last.app</strong><small>Asignación manual desde LastPOS</small>'
       :'<select data-assign="'+esc(o.id)+'" '+(["entregado","cancelado"].includes(o.status)?"disabled":"")+'>'+options+'</select>')+'</td><td><button class="outline" type="button" data-edit="'+esc(o.id)+'">Editar</button></td>'+
      '<td><div class="share-actions"><button class="outline" type="button" data-track="'+esc(o.id)+'">🔗 Enlace</button>'+
      '<button class="outline whatsapp-action" type="button" data-wa="'+esc(o.id)+'" '+((o.notifications_consent&&o.notification_channel==="whatsapp"&&whatsappNumber(o.customer_phone))?"":'disabled title="Indica teléfono y activa WhatsApp con consentimiento en Editar"')+'>💬 Enviar seguimiento</button>'+
      (locationShares.get(o.id)?'<button class="outline stop-public-gps" type="button" data-stop-public-gps="'+esc(o.id)+'">■ Ocultar GPS del cliente</button>':'')+
      '</div></td></tr>';
  }).join("")||'<tr class="ops-empty"><td colspan="8">No hay pedidos con esos filtros. Modifica la búsqueda o pulsa «Limpiar filtros».</td></tr>';
 }else{
  el("myOrders").innerHTML=orders.map(o=>{
    const n=next[o.status],map=mapsLink(o);
    return '<article class="my-order"><small>'+esc(chan[o.channel]||o.channel)+'</small><h3>'+esc(o.reference)+'</h3><p><strong>'+esc(o.customer_name)+'</strong></p><p>'+esc(o.destination)+'</p><p class="pill">'+esc(labels[o.status])+'</p><div class="actions">'+(map?'<a target="_blank" rel="noopener noreferrer" href="'+map+'">Google Maps ↗</a>':"")+(n?'<button class="btn" data-advance="'+esc(o.id)+'" data-next="'+n+'">'+esc({recogido:"Recogido",en_ruta:"Iniciar reparto",entregado:"Entregado"}[n])+'</button>':"")+'</div></article>';
  }).join("")||'<p>No hay pedidos asignados a este rider.</p>';
 }
}

  document.querySelector("#loading")?.setAttribute("hidden","");
  el("noConfig").hidden=true;el("loginSection").hidden=true;el("appSection").hidden=false;el("staffView").hidden=false;
  el("accountLabel").textContent="DEMOSTRACIÓN · ESTAMBUL";el("connection").textContent="DEMO · SIN CONEXIÓN";
  el("logout").hidden=true;el("operationsResetCard").hidden=false;el("inviteCard").hidden=true;
  el("resetOperationsButton").disabled=false;el("restoreOperationsButton").disabled=true;
  el("resetOperationsStatus").textContent="Simulación local; no modifica pedidos reales.";
  render();
  el("opsSearch").addEventListener("input",e=>{opsQuery=normalizeOps(e.target.value);render();});
  el("opsFocus").addEventListener("change",e=>{opsFocus=e.target.value;render();});
  el("opsChannel").addEventListener("change",e=>{opsChannel=e.target.value;render();});
  el("opsReset").addEventListener("click",()=>{opsQuery="";opsFocus="all";opsChannel="all";el("opsSearch").value="";el("opsFocus").value="all";el("opsChannel").value="all";render();});
  document.querySelectorAll("[data-ops-focus]").forEach(b=>b.addEventListener("click",()=>{opsFocus=b.dataset.opsFocus;el("opsFocus").value=opsFocus;render();}));
  el("showArchivedOrders").addEventListener("change",e=>{showArchivedOrders=e.target.checked;render();});
  el("refresh").addEventListener("click",()=>{lastReloadAt=Date.now();render();notice("Actualización de datos ficticios. No se consultó Supabase.");});
  el("resetOperationsButton").addEventListener("click",()=>{orders=orders.filter(x=>x.status==="en_ruta");operationsEpoch={previous_started_at:Date.now()};el("restoreOperationsButton").disabled=false;render();notice("Vista ficticia limpiada. Usa recuperar para volver a mostrar la demostración.");});
  const original=[
   {id:"d101",reference:"LA-DEMO-101",channel:"lastapp",customer_name:"Cliente ficticio A",destination:"Dirección de ejemplo · Burgos",status:"pendiente",amount:18.50,rider_id:null,payment_method:null,notes:"Pedido de demostración",notifications_consent:false,notification_channel:"none"},
   {id:"d102",reference:"LA-DEMO-102",channel:"lastapp",customer_name:"Cliente ficticio B",destination:"Calle de prueba · Burgos",status:"en_ruta",amount:26.50,rider_id:"demo-rider-1",payment_method:"efectivo",notes:"Dos pizzas y una bebida (ficticias)",notifications_consent:true,notification_channel:"sms"},
   {id:"d103",reference:"PRUEBA-103",channel:"test",customer_name:"Cliente simulado C",destination:"Ejemplo 3 · Burgos",status:"asignado",amount:14.95,rider_id:"demo-rider-1",payment_method:"tarjeta",notes:"Sin datos reales",notifications_consent:false,notification_channel:"none"},
   {id:"d104",reference:"LA-DEMO-104",channel:"lastapp",customer_name:"Cliente ficticio D",destination:"Ejemplo 4 · Burgos",status:"entregado",amount:21.00,rider_id:"demo-rider-1",payment_method:null,notes:"Falta conciliar",notifications_consent:false,notification_channel:"none"}
  ];
  el("restoreOperationsButton").addEventListener("click",()=>{orders=original.map(x=>({...x}));el("restoreOperationsButton").disabled=true;render();notice("Vista ficticia recuperada.");});
  document.addEventListener("click",e=>{
   const b=e.target.closest("button");
   if(!b)return;
   if(b.dataset.track){location.href="cliente.html";return;}
   if(b.dataset.edit){notice("Edición desactivada: es una previsualización sin datos reales.");return;}
  });
  document.addEventListener("change",e=>{
   const select=e.target.closest("select[data-assign]");
   if(!select)return;
   const order=orders.find(o=>o.id===select.dataset.assign);
   if(order&&order.channel==="test"){order.rider_id=select.value||null;render();notice("Asignación de prueba simulada; LastPOS no se modificó.");}
  });
  el("createForm").addEventListener("submit",e=>{
   const f=e.currentTarget;
   orders.unshift({id:"demo-"+Date.now(),reference:el("newReference").value||"PRUEBA",channel:"test",customer_name:el("newCustomer").value||"Cliente demo",destination:el("newAddress").value||"Dirección ficticia",status:"pendiente",amount:Number(el("newAmount").value)||0,rider_id:null,payment_method:el("newPayment").value||null,notes:el("newNotes").value||"",notifications_consent:false,notification_channel:"none"});
   render();f.reset();notice("Pedido ficticio añadido a la vista de pruebas. Nada se ha guardado.");
  });
 }
 function previewRider(){
 const escapeText=esc;
 const euros=v=>new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(Number(v||0));
 const statusNames={pendiente:"Pendiente",asignado:"Asignado",recogido:"Recogido",en_ruta:"En ruta",entregado:"Entregado",cancelado:"Cancelado"};
 const channelNames={test:"Prueba",lastapp:"Last.app",uber:"Uber Eats",justeat:"Just Eat"};
 const allowedNext={asignado:"recogido",recogido:"en_ruta",en_ruta:"entregado"};
 const nextNames={recogido:"Confirmar recogida",en_ruta:"Iniciar reparto",entregado:"Confirmar entrega"};
 const paymentDrafts=new Map(),locationShares=new Map();
 const locationSharingAvailable=true;
 const canShareFollowup=()=>false;
 const waitMinutes=o=>Math.max(0,Math.round((Date.now()-Date.parse(o.created_at))/60000));
 const waitLabel=o=>"Hace "+waitMinutes(o)+" min";
 const displayOrderCode=o=>String(o.reference).replace(/^LA-DEMO-/,"DEMO-");
 const itemController=window.ESTAMBUL_ORDER_ITEMS?.createController(escapeText,true);
 let orders=[
  {id:"demo1",reference:"LA-DEMO-201",channel:"lastapp",customer_name:"Cliente ficticio A",customer_phone:null,destination:"Dirección de ejemplo, Burgos",notes:"Dos pizzas y bebida · SOLO DEMO",amount:29.9,payment_method:null,status:"asignado",accepted_at:null,notifications_consent:false,notification_channel:"none",created_at:new Date(Date.now()-12*60000).toISOString()},
  {id:"demo2",reference:"LA-DEMO-202",channel:"lastapp",customer_name:"Cliente ficticio B",customer_phone:null,destination:"Otra dirección ficticia, Burgos",notes:"Sin datos reales",amount:16.5,payment_method:"efectivo",status:"en_ruta",accepted_at:new Date().toISOString(),notifications_consent:false,notification_channel:"none",created_at:new Date(Date.now()-28*60000).toISOString()},
  {id:"demo3",reference:"LA-DEMO-203",channel:"lastapp",customer_name:"Cliente ficticio C",customer_phone:null,destination:"Entrega completada · Burgos",notes:"",amount:20,payment_method:"tarjeta",status:"entregado",accepted_at:new Date().toISOString(),notifications_consent:false,notification_channel:"none",created_at:new Date(Date.now()-60*60000).toISOString()}
 ];
function mapUrl(order) {
  let target="";
  if(order.lat!=null && order.lng!=null)target=String(order.lat)+","+String(order.lng);
  else{
    const destination=String(order.destination||"").trim();
    if(destination)target=/burgos|españa|spain/i.test(destination)?destination:destination+", Burgos, España";
  }
  return target?"https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(target)+"&travelmode=driving":"";
}
function renderHistoryOrder(order){
 const pay=order.payment_method==="efectivo"?"💶 Efectivo":order.payment_method==="tarjeta"?"💳 Tarjeta":"Pago sin indicar";
 return '<article class="history-row">'+
  '<span class="history-row-status" aria-label="Entregado">✓</span>'+
  '<div class="history-row-main"><strong>#'+escapeText(displayOrderCode(order))+'</strong><span>'+escapeText(order.customer_name)+'</span>'+
  '<small>'+escapeText(pay)+'</small></div>'+
  '<div class="history-row-end"><strong>'+euros(order.amount)+'</strong><small>Entregado</small></div></article>';
}
function renderOrder(order,isPriority=false) {
  const nextStatus=allowedNext[order.status];
  const draftPayment=paymentDrafts.get(order.id)??order.payment_method??"";
  const paymentConfirmation=nextStatus==="entregado"
    ?'<label class="payment-confirmation" for="payment-'+escapeText(order.id)+'">'+
      '<span>CONFIRMA EL COBRO ANTES DE ENTREGAR</span>'+
      '<select id="payment-'+escapeText(order.id)+'" data-payment-for="'+escapeText(order.id)+'" required>'+
       '<option value="">Seleccionar método de pago</option>'+
       '<option value="efectivo" '+(draftPayment==="efectivo"?"selected":"")+
       '>💶 Efectivo cobrado</option>'+
       '<option value="tarjeta" '+(draftPayment==="tarjeta"?"selected":"")+
       '>💳 Tarjeta / pago digital confirmado</option></select>'+
      '<small>Verifica lo cobrado de verdad, aunque Last.app haya indicado una preferencia.</small>'+
     '</label>':"";
  const url=mapUrl(order);
  const phone=String(order.customer_phone||"").replace(/[^+0-9]/g,"");
  const tel=(phone.length>=6&&phone.length<=16)?"tel:"+phone:"";
  const status=escapeText(statusNames[order.status]||order.status);
  const guestSharing=Boolean(locationShares.get(order.id));
  const guestButton=locationSharingAvailable&&["recogido","en_ruta"].includes(order.status)
    ?'<button type="button" class="guest-share-action '+(guestSharing?'on':'')+'" data-public-gps="'+escapeText(order.id)+'" aria-pressed="'+guestSharing+'">'+
      (guestSharing?'● Detener mapa del cliente':'◎ Compartir GPS con este cliente')+'</button>'
    :'';
  const progressAction=nextStatus==="entregado"
    ?'<div class="swipe-finish" data-swipe-order="'+escapeText(order.id)+'" aria-label="Desliza para marcar entregado">'+
      '<span class="swipe-progress"></span><span class="swipe-prompt">Desliza para entregar →</span>'+
      '<button type="button" class="swipe-handle" aria-label="Desliza hacia la derecha para confirmar entrega">➜</button></div>'+
      '<button type="button" class="finish-accessible" data-order="'+escapeText(order.id)+'" data-next="entregado">Confirmar entrega con botón</button>'
    :nextStatus?'<button type="button" data-order="'+escapeText(order.id)+'" data-next="'+nextStatus+'">'+escapeText(nextNames[nextStatus])+' →</button>':'';
  const actions=(url?'<a class="maps-action" href="'+escapeText(url)+'" target="_blank" rel="noopener noreferrer">📍 Google Maps ↗</a>':'')+
      (tel?'<a class="phone-action" href="'+escapeText(tel)+'">☎ Llamar</a>':'')+
      (["asignado","recogido","en_ruta"].includes(order.status)?'<button type="button" class="chat-action" data-chat="'+escapeText(order.id)+'">💬 Chat cliente</button>':'')+
      (order.status==="asignado"&&!order.accepted_at
        ?'<button type="button" class="accept-action" data-accept="'+escapeText(order.id)+'">✅ Aceptar pedido'+
          (order.notifications_consent&&order.notification_channel==="sms"?" · SMS automático":
           canShareFollowup(order)?" · WhatsApp manual":"")+'</button>'
        :progressAction)+guestButton+
      (order.accepted_at&&["asignado","recogido","en_ruta"].includes(order.status)
        ?'<span class="one-link-note">✓ Enlace inicial enviado · sin SMS por estados</span>':'');
  return '<article class="order-card '+(isPriority?"priority-order":"active-order")+'">'+
    '<div class="order-top"><div><span class="order-number">#'+escapeText(displayOrderCode(order))+
    '</span><span class="channel">'+escapeText(channelNames[order.channel]||order.channel)+
    '</span></div><span class="status '+escapeText(order.status)+'">'+status+'</span></div>'+
    '<div class="order-wait '+(waitMinutes(order)>=30?"order-wait-urgent":waitMinutes(order)>=15?"order-wait-warning":"")+'">◷ '+escapeText(waitLabel(order))+(waitMinutes(order)>=30?" · ENTREGA PRIORITARIA":"")+'</div>'+
    (isPriority?'<span class="priority-tag">● REPARTO EN CURSO</span>':'')+
    '<div class="client-label">CLIENTE</div><h3 class="destination-head">'+escapeText(order.customer_name)+'</h3>'+
    (order.customer_phone?'<p class="client-phone">☎ '+escapeText(order.customer_phone)+'</p>':'<p class="missing-detail">Sin teléfono de cliente registrado</p>')+
    '<div class="client-label client-label-gap">DIRECCIÓN DE ENTREGA</div>'+
    '<p class="destination">📍 '+escapeText(order.destination)+'</p>'+
    (order.notes?'<div class="delivery-notes"><strong>📝 Instrucciones</strong><p>'+escapeText(order.notes)+'</p></div>':'')+
    (itemController?.render(order)||"")+
    '<div class="payment-panel '+(order.payment_method==="efectivo"?"cash":order.payment_method==="tarjeta"?"card":"unknown")+'">'+
    '<span class="payment-title">'+escapeText(order.payment_method==="efectivo"?"💶 COBRAR EN EFECTIVO":order.payment_method==="tarjeta"?"💳 PAGO CON TARJETA":"PAGO SIN INDICAR")+'</span>'+
    '<strong>'+(String(order.reference||"").startsWith("LA-")&&Number(order.amount)===0?
      "0,00 € · verificar importe en Last.app":euros(order.amount))+'</strong></div>'+
    paymentConfirmation+
    '<div class="actions">'+actions+'</div></article>';
}


 let showHistory=false;
 $("loading").hidden=true;$("login").hidden=true;$("dashboard").hidden=false;
 $("setPassword").hidden=true;$("setup").hidden=true;
 $("riderName").textContent="RIDER 01";$("accountName").textContent="ESTAMBUL · DATOS FICTICIOS";
 $("onlineLabel").textContent="Estoy disponible";$("onlineLight").classList.add("active");
 $("riderSyncHealth").textContent="● Simulación local";$("syncStamp").textContent="Vista de ejemplo · "+now();
 const initialItems=[
  {order_id:"demo1",revision:"demo-a",items:[{name:"Pizza Margarita",quantity:2,modifiers:[],children:[],comments:""},{"name":"Coca-Cola",quantity:1,modifiers:[],children:[],comments:""},{"name":"Patatas fritas",quantity:1,modifiers:[],children:[],comments:""}]},
  {order_id:"demo2",revision:"demo-b",items:[{name:"Pizza Barbacoa",quantity:1,modifiers:[],children:[],comments:""},{"name":"Agua",quantity:2,modifiers:[],children:[],comments:""}]}
 ];
 function draw(){
  const active=orders.filter(o=>!["entregado","cancelado"].includes(o.status)),inRoute=active.filter(o=>o.status==="en_ruta"),toCollect=active.filter(o=>o.status!=="en_ruta"),done=orders.filter(o=>o.status==="entregado");
  $("pendingCount").textContent=active.length;$("routeCount").textContent=inRoute.length;$("doneCount").textContent=done.length;
  $("listCount").textContent=active.length;$("historyCount").textContent=done.length;
  $("orders").innerHTML=(inRoute.length?'<div class="group-title">EN REPARTO <small>'+inRoute.length+'</small></div>'+inRoute.map(o=>renderOrder(o,true)).join(""):"")+
    (toCollect.length?'<div class="group-title">POR RECOGER / PREPARAR <small>'+toCollect.length+'</small></div>'+toCollect.map(o=>renderOrder(o,false)).join(""):"")
    ||'<div class="empty">No quedan pedidos ficticios activos.</div>';
  $("historyOrders").innerHTML=showHistory?done.map(renderHistoryOrder).join(""):"";
  $("historyPanel").hidden=!showHistory;$("historyChevron").textContent=showHistory?"Ocultar ↑":"Mostrar ↓";
  $("syncStamp").textContent="Simulación local · "+now();
 }
 draw();
 if(itemController)itemController.load(orders,async()=>initialItems,draw);
 $("orders").addEventListener("change",e=>{
  if(e.target.matches("select[data-payment-for]")){paymentDrafts.set(e.target.dataset.paymentFor,e.target.value);return;}
  itemController?.onChange(e);
 });
 $("orders").addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b)return;
  const oid=b.dataset.order||b.dataset.accept||b.dataset.publicGps||b.dataset.chat;
  const o=orders.find(x=>x.id===oid);
  if(!o)return;
  if(b.dataset.accept){o.accepted_at=new Date().toISOString();notice("Pedido aceptado SOLO en simulación. No se envió SMS.");draw();return;}
  if(b.dataset.publicGps){locationShares.set(o.id,!locationShares.get(o.id));draw();notice("Mapa GPS simulado; no se comparte una ubicación.");return;}
  if(b.dataset.chat){notice("El chat no envía mensajes en esta simulación.");return;}
  if(b.dataset.next){
   if(b.dataset.next==="entregado"&&!["efectivo","tarjeta"].includes(paymentDrafts.get(o.id)||o.payment_method)){
    notice("Confirma antes el método de cobro (simulación).");return;
   }
   if(b.dataset.next==="entregado")o.payment_method=paymentDrafts.get(o.id)||o.payment_method;
   o.status=b.dataset.next;draw();notice("Estado actualizado en datos ficticios.");return;
  }
  notice("Control de demostración. No se realiza ninguna acción externa.");
 });
 $("toggleHistory").addEventListener("click",()=>{showHistory=!showHistory;draw();});
 $("refreshButton").addEventListener("click",()=>{draw();notice("Sincronización simulada; no se consultó LastPOS.");});
 $("availabilityButton").addEventListener("click",()=>{const x=$("onlineLabel");const online=x.textContent!=="Estoy disponible";x.textContent=online?"Estoy disponible":"No disponible";$("onlineLight").classList.toggle("active",online);notice("Disponibilidad ficticia.");});
 $("toggleGps").addEventListener("click",()=>notice("GPS desactivado en la previsualización."));
 $("reviewDay").addEventListener("click",()=>{$("dayClosePanel").hidden=!$("dayClosePanel").hidden;$("dayCloseTotals").textContent="Arqueo simulado · efectivo 16,50 € · tarjeta 20,00 €";});
 $("finalizeDay").addEventListener("click",()=>notice("Arqueo solo de demostración; no se cierra ningún turno real."));
 $("optimizeRoute").addEventListener("click",()=>notice("Rutas de demostración. Nunca modifica asignaciones LastPOS."));
 $("enableSound").addEventListener("click",()=>notice("Alarma de muestra no vinculada a pedidos reales."));
 $("testSound").addEventListener("click",()=>notice("Vista de prueba: alertas simuladas."));
 }
 function previewClient(){
 $("loading").hidden=true;$("notFound").hidden=true;$("orderContent").hidden=false;
 let status="asignado";
 const stages=[
  ["pendiente","Pedido recibido","El restaurante ha recibido la solicitud."],
  ["asignado","Repartidor asignado","Tu pedido está en preparación para el reparto."],
  ["recogido","Pedido recogido","El repartidor ya tiene el pedido."],
  ["en_ruta","En camino","Tu pedido está de camino."],
  ["entregado","Entregado","El repartidor ha finalizado la entrega."]
 ];
 const picker=document.createElement("div");picker.className="parity-status-picker";
 picker.innerHTML='<label for="demoStatus">CAMBIAR ESTADO FICTICIO</label><select id="demoStatus">'+stages.map(([id,title])=>'<option value="'+id+'">'+title+'</option>').join("")+'</select>';
 $("orderContent").prepend(picker);
 $("demoStatus").value=status;
 function draw(){
  const presentation=window.ESTAMBUL_TRACK_PRESENTATION.presentation(status);
  $("waitingIcon").textContent=presentation.icon;$("waitingTitle").textContent=presentation.title;
  $("waitingMessage").textContent=presentation.description;$("waitingNext").textContent=presentation.next;
  $("waitingFreshness").textContent="Simulación · "+now();
  $("orderRef").textContent="Pedido #DEMO-204";
  $("liveStatus").textContent=stages.find(x=>x[0]===status)?.[1]||status;
  $("orderDescription").textContent="Seguimiento de demostración: ningún pedido real conectado.";
  $("progressBar").style.width=presentation.progress+"%";
  $("orderProgress").setAttribute("aria-valuenow",presentation.progress);
  $("progressText").textContent="Paso "+presentation.stepNumber+" de 5 · "+presentation.step;
  $("steps").innerHTML=stages.map(([id,title,info],i)=>{
    const index=stages.findIndex(x=>x[0]===status);
    return '<div class="step '+(i<index?"past":i===index?"current":"")+'"><span class="step-number">'+(i<=index?"✓":i+1)+'</span><div><strong>'+title+'</strong><p>'+info+'</p></div></div>';
  }).join("");
  $("updatedAt").textContent="Estado ficticio · "+now();
  $("arrivalTitle").textContent=status==="entregado"?"¡Pedido entregado!":status==="en_ruta"?"Repartidor en camino":"Estamos preparando tu pedido";
  $("arrivalDescription").textContent=status==="en_ruta"?"No se ha proporcionado GPS en esta simulación.":"Sin tiempo estimado real disponible.";
  $("arrivalConfidence").textContent="No mostramos una llegada inventada.";
  $("arrivalDetails").hidden=true;$("liveMapPanel").hidden=true;
  $("customerChatPanel").hidden=true;$("riderCallPanel").hidden=true;
  $("feedbackPanel").hidden=true;$("feedbackDone").hidden=true;$("reviewPanel").hidden=true;
 }
 $("demoStatus").addEventListener("change",e=>{status=e.target.value;draw();});
 $("refreshButton").addEventListener("click",()=>{draw();notice("Seguimiento simulado; no se enviaron SMS ni datos.");});
 draw();
 }
})();