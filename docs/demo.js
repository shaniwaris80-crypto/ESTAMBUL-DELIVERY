/* ESTAMBUL DELIVERY — 100% SIMULACIÓN LOCAL. No autenticación ni datos reales. */
(function() {"use strict";
var KEY="estambul-demo-v3";
var initial=function(){return {riders:[
{id:"r-a",name:"Rider A",active:true,online:true,lat:42.3520,lng:-3.6665},
{id:"r-b",name:"Rider B",active:true,online:true,lat:42.3448,lng:-3.6882},
{id:"r-c",name:"Rider C",active:true,online:false,lat:42.3400,lng:-3.6942},
{id:"r-d",name:"Rider D",active:true,online:true,lat:42.3600,lng:-3.6490}
],orders:[
{id:"ED-1001",channel:"lastapp",customer:"Cliente A",address:"Punto de prueba · Gamonal",lat:42.3565,lng:-3.6545,riderId:"r-a",status:"en_ruta",amount:23.40},
{id:"ED-1002",channel:"uber",customer:"Cliente B",address:"Punto de prueba · Centro",lat:42.3412,lng:-3.6971,riderId:"r-b",status:"asignado",amount:17.80},
{id:"ED-1003",channel:"justeat",customer:"Cliente C",address:"Punto de prueba · Río Vena",lat:42.3481,lng:-3.6739,riderId:"r-a",status:"recogido",amount:31.25},
{id:"ED-1004",channel:"lastapp",customer:"Cliente D",address:"Punto de prueba · San Pedro",lat:42.3364,lng:-3.7201,riderId:null,status:"pendiente",amount:19.90},
{id:"ED-1005",channel:"uber",customer:"Cliente E",address:"Punto de prueba · Capiscol",lat:42.3611,lng:-3.6432,riderId:"r-d",status:"en_ruta",amount:28.60},
{id:"ED-1006",channel:"justeat",customer:"Cliente F",address:"Punto de prueba · San Lesmes",lat:42.3439,lng:-3.6917,riderId:null,status:"pendiente",amount:12.50},
{id:"ED-1007",channel:"lastapp",customer:"Cliente G",address:"Punto de prueba · Plaza Mayor",lat:42.3407,lng:-3.7012,riderId:"r-b",status:"entregado",amount:25.00}
]};};
var channels={lastapp:"Last.app",uber:"Uber Eats",justeat:"Just Eat"};
var labels={pendiente:"Pendiente",asignado:"Asignado",recogido:"Recogido",en_ruta:"En reparto",entregado:"Entregado"};
var progress={asignado:"recogido",recogido:"en_ruta",en_ruta:"entregado"};
var nextLabels={recogido:"Confirmar recogida",en_ruta:"Iniciar reparto",entregado:"Completar entrega"};
var palette=["#2684c0","#11a678","#d5803d","#945dd3","#df5865"];
function el(id){return document.getElementById(id);}
function esc(x){return String(x==null?"":x).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function euro(x){return new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(x);}
function load(){try{var v=JSON.parse(localStorage.getItem(KEY));if(Array.isArray(v.riders)&&Array.isArray(v.orders))return v;}catch(e){}return initial();}
var data=load(),phoneId="r-a",trackId="ED-1001";
function save(){try{localStorage.setItem(KEY,JSON.stringify(data));}catch(e){}}
function active(){return data.riders.filter(function(r){return r.active;});}
function openOrders(){return data.orders.filter(function(o){return o.status!=="entregado";});}
function forRider(id){return openOrders().filter(function(o){return o.riderId===id;});}
function maps(o){return "https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(o.lat+","+o.lng)+"&travelmode=driving";}
function optionRiders(chosen,all){
return (all?'<option value="all">Todos los riders</option>':'<option value="">Sin asignar</option>')+active().map(function(r){return '<option value="'+esc(r.id)+'" '+(r.id===chosen?"selected":"")+'>'+esc(r.name)+'</option>';}).join("");
}
function stat(name,note,value,tone){return '<div class="stat"><div class="stat-label">'+name+'</div><div class="stat-value '+(tone||"")+'">'+value+'</div><div class="stat-sub">'+note+'</div></div>';}
function renderStats(){var o=openOrders(),done=data.orders.length-o.length;
el("stats").innerHTML=stat("Pedidos del día","Tres canales",data.orders.length)+stat("Sin asignar","Requieren un rider",o.filter(function(x){return !x.riderId;}).length,"orange")+stat("En reparto","Riders activos",o.filter(function(x){return x.status==="en_ruta";}).length,"blue")+stat("Por entregar","Pendientes totales",o.length)+stat("Entregados","Finalizados",done,"green")+stat("Riders conectados",active().length+" registrados",active().filter(function(x){return x.online;}).length,"green");}
function renderRiders(){
el("ridersCount").textContent=active().length+" activos";
el("ridersList").innerHTML=data.riders.map(function(r){
var initials=r.name.split(/\s+/).slice(0,2).map(function(s){return s[0];}).join("").toUpperCase();
return '<div class="rider-line" style="'+(r.active?"":"opacity:.52")+'"><div class="avatar">'+esc(initials)+'</div><div class="rider-meta"><strong>'+esc(r.name)+'</strong><small>'+(!r.active?"○ Desactivado":r.online?"● Conectado (simulado)":"○ Desconectado")+' · '+forRider(r.id).length+' entregas</small></div><button class="disable '+(r.active?"":"off")+'" data-toggle="'+esc(r.id)+'" title="Simular alta o baja" aria-label="Cambiar estado '+esc(r.name)+'">'+(r.active?"✓":"—")+'</button></div>';
}).join("");
var filter=el("riderFilter"),chosen=filter.value||"all";filter.innerHTML=optionRiders(chosen,true);if(!Array.from(filter.options).some(function(x){return x.value===chosen;}))filter.value="all";
}
function renderOrders(){
var ch=el("channelFilter").value,rr=el("riderFilter").value,del=el("showDelivered").checked;
var orders=data.orders.filter(function(o){return (ch==="all"||o.channel===ch)&&(rr==="all"||o.riderId===rr)&&(del||o.status!=="entregado");});
el("resultCount").textContent=orders.length+" pedidos";
el("orderRows").innerHTML=orders.map(function(o){
var states=Object.keys(labels).map(function(s){return '<option value="'+s+'" '+(s===o.status?"selected":"")+'>'+labels[s]+'</option>';}).join("");
return '<tr><td><strong>'+esc(o.id)+'</strong><span class="channel '+esc(o.channel)+'">'+channels[o.channel]+'</span></td><td><strong>'+esc(o.customer)+'</strong><small>'+esc(o.address)+'</small></td><td class="price">'+euro(o.amount)+'</td><td><select data-assign="'+esc(o.id)+'" aria-label="Asignar '+esc(o.id)+'" '+(o.status==="entregado"?"disabled":"")+'>'+optionRiders(o.riderId,false)+'</select></td><td><select data-status="'+esc(o.id)+'" aria-label="Estado '+esc(o.id)+'" '+(!o.riderId||o.status==="entregado"?"disabled":"")+'>'+states+'</select></td><td><a class="map-link" target="_blank" rel="noopener noreferrer" href="'+maps(o)+'">Google Maps ↗</a></td></tr>';
}).join("")||'<tr><td colspan="6" class="empty">No hay pedidos con estos filtros</td></tr>';}
function point(lat,lng){return {x:Math.max(20,Math.min(730,(lng+3.735)/.11*750)),y:Math.max(20,Math.min(380,(42.368-lat)/.04*400))};}
function renderMap(){
var rr=el("riderFilter").value, riders=active().filter(function(r){return r.online&&(rr==="all"||rr===r.id);}), orders=openOrders().filter(function(o){return rr==="all"||o.riderId===rr;});
el("routeLayer").innerHTML=riders.map(function(r,i){var locations=[r].concat(orders.filter(function(o){return o.riderId===r.id;}));if(locations.length<2)return "";return '<polyline class="route-line" stroke="'+palette[i%palette.length]+'" points="'+locations.map(function(loc){var p=point(loc.lat,loc.lng);return p.x.toFixed(1)+","+p.y.toFixed(1);}).join(" ")+'"></polyline>';}).join("");
el("orderLayer").innerHTML=orders.map(function(o){var p=point(o.lat,o.lng);return '<g class="marker" role="button" tabindex="0" data-pin="'+esc(o.id)+'" aria-label="Pedido '+esc(o.id)+'"><circle class="pin-dot" cx="'+p.x+'" cy="'+p.y+'" r="13" fill="#e96c58"/><text x="'+p.x+'" y="'+p.y+'">'+esc(o.id.slice(-2))+'</text></g>';}).join("");
el("riderLayer").innerHTML=riders.map(function(r,i){var p=point(r.lat,r.lng);return '<g class="marker" tabindex="0" role="button" data-rider-pin="'+esc(r.id)+'" aria-label="'+esc(r.name)+'"><circle class="pin-dot" cx="'+p.x+'" cy="'+p.y+'" r="18" fill="'+palette[i%palette.length]+'"/><text x="'+p.x+'" y="'+p.y+'">🚴</text></g>';}).join("");
}
function renderPhone(){
if(!active().some(function(r){return r.id===phoneId;}))phoneId=active()[0]?.id||"";
el("phoneRider").innerHTML=active().map(function(r){return '<option value="'+esc(r.id)+'" '+(phoneId===r.id?"selected":"")+'>'+esc(r.name)+'</option>';}).join("");
var person=active().find(function(r){return r.id===phoneId;});
var orders=forRider(phoneId),done=data.orders.filter(function(o){return o.riderId===phoneId&&o.status==="entregado";}).length;
el("phoneName").textContent=person?.name||"Sin riders";el("phoneCount").textContent=orders.length;
el("phoneStats").innerHTML=[[orders.length,"Pendientes"],[orders.filter(function(o){return o.status==="en_ruta";}).length,"En reparto"],[done,"Entregados"]].map(function(a){return '<div><strong>'+a[0]+'</strong><small>'+a[1]+'</small></div>';}).join("");
el("phoneOrders").innerHTML=orders.length?orders.map(function(o){var next=progress[o.status];
return '<article class="phone-order"><div class="row"><strong>#'+esc(o.id)+'</strong><span class="status-tag '+esc(o.status)+'">'+labels[o.status]+'</span></div><p class="address">'+esc(o.customer)+'<br>📍 '+esc(o.address)+'</p><div class="actions"><a href="'+maps(o)+'" target="_blank" rel="noopener noreferrer">↗ Google Maps</a>'+(next?'<button data-next="'+esc(o.id)+'">'+nextLabels[next]+'</button>':"")+'</div></article>';
}).join(""):'<article class="phone-order">Sin pedidos pendientes. Puedes asignarlos desde el back office.</article>';}
function renderTracking(){
if(!data.orders.some(function(o){return o.id===trackId;}))trackId=data.orders[0]?.id||"";
el("trackOrder").innerHTML=data.orders.map(function(o){return '<option value="'+esc(o.id)+'" '+(trackId===o.id?"selected":"")+'>'+esc(o.id)+" · "+esc(o.customer)+'</option>';}).join("");
var o=data.orders.find(function(x){return x.id===trackId;});if(!o)return;
var rider=active().find(function(r){return r.id===o.riderId;});var percentages={pendiente:8,asignado:25,recogido:48,en_ruta:78,entregado:100};
el("trackingInfo").innerHTML='<div style="padding:17px;border:1px solid #e4e9ef;border-radius:12px;margin-top:16px"><strong>'+esc(o.id)+' · '+esc(o.customer)+'</strong><p>'+esc(o.address)+'</p><p><b>Estado:</b> '+labels[o.status]+'<br><b>Rider:</b> '+esc(rider?.name||"Sin asignar")+'</p></div>';el("trackingProgress").style.width=percentages[o.status]+"%";
}
function render(){renderStats();renderRiders();renderOrders();renderMap();renderPhone();renderTracking();}
function update(fn){fn();save();render();}
function switchView(v){document.querySelectorAll(".nav").forEach(function(n){n.classList.toggle("active",n.dataset.view===v);});["admin","rider","track"].forEach(function(k){el(k+"View").hidden=k!==v;});
var titles={admin:["Control de repartos","Mapa de riders, asignaciones y entregas en una sola pantalla."],rider:["Aplicación del repartidor","Así recibe cada rider sus pedidos en la aplicación."],track:["Seguimiento para clientes","Visualización ficticia para el destinatario del pedido."]};el("heading").textContent=titles[v][0];el("subheading").textContent=titles[v][1];render();}
document.addEventListener("click",function(ev){var b=ev.target.closest("button");
if(b?.dataset.view)switchView(b.dataset.view);
if(b?.dataset.switch)switchView(b.dataset.switch);
if(b?.dataset.toggle){var rid=b.dataset.toggle;update(function(){var r=data.riders.find(function(x){return x.id===rid;});if(!r)return;r.active=!r.active;if(!r.active){r.online=false;data.orders.forEach(function(o){if(o.riderId===rid&&o.status!=="entregado"){o.riderId=null;o.status="pendiente";}});}});}
if(b?.dataset.next){var oid=b.dataset.next;update(function(){var o=data.orders.find(function(x){return x.id===oid;});if(o&&o.riderId===phoneId&&progress[o.status])o.status=progress[o.status];});}
if(b?.id==="moveGPS")update(function(){active().filter(function(x){return x.online;}).forEach(function(r){r.lat=Math.min(42.367,r.lat+.00055);r.lng=Math.max(-3.734,r.lng-.00075);});});
if(b?.id==="reset"&&confirm("¿Restablecer los datos ficticios?")){data=initial();phoneId="r-a";el("channelFilter").value="all";el("riderFilter").value="all";save();render();}
var pin=ev.target.closest("[data-pin]");if(pin){var op=data.orders.find(function(x){return x.id===pin.dataset.pin;});if(op)alert(op.id+" · "+op.customer+"\n"+op.address+"\n"+labels[op.status]);}
var riderPin=ev.target.closest("[data-rider-pin]");if(riderPin){var rp=data.riders.find(function(x){return x.id===riderPin.dataset.riderPin;});if(rp)alert(rp.name+" · "+forRider(rp.id).length+" pendientes\nUbicación simulada.");}
});
document.addEventListener("keydown",function(ev){if((ev.key==="Enter"||ev.key===" ")&&ev.target.matches(".marker")){ev.preventDefault();ev.target.dispatchEvent(new MouseEvent("click",{bubbles:true}));}});
document.addEventListener("change",function(ev){var t=ev.target;
if(t.dataset.assign!==undefined){update(function(){var o=data.orders.find(function(x){return x.id===t.dataset.assign;});if(o&&o.status!=="entregado"){o.riderId=t.value||null;o.status=o.riderId?"asignado":"pendiente";}});}
else if(t.dataset.status){update(function(){var o=data.orders.find(function(x){return x.id===t.dataset.status;});if(o&&o.riderId&&o.status!=="entregado"&&labels[t.value])o.status=t.value;});}
else if(["channelFilter","riderFilter","showDelivered"].includes(t.id)){renderOrders();renderMap();}
else if(t.id==="phoneRider"){phoneId=t.value;renderPhone();}
else if(t.id==="trackOrder"){trackId=t.value;renderTracking();}
});
el("addRider").addEventListener("submit",function(e){e.preventDefault();var input=el("riderName"),name=input.value.trim();if(!name)return;
if(data.riders.some(function(r){return r.active&&r.name.toLocaleLowerCase("es")===name.toLocaleLowerCase("es");})){alert("Ya hay un rider activo con ese nombre.");return;}
update(function(){data.riders.push({id:"r-"+Date.now(),name:name,active:true,online:false,lat:42.35,lng:-3.686});});input.value="";});
if("serviceWorker" in navigator)window.addEventListener("load",function(){navigator.serviceWorker.register("./sw.js").catch(function(){});});
render();
})();