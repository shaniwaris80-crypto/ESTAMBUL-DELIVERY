import {SAFETY_FLAGS,sampleData,summarizeFinance,summarizeOperations,summarizeRiders,customerView,euros} from "./labs-core.mjs";
const byId=id=>document.getElementById(id);
const labelStatus={pendiente:"Pedido recibido",asignado:"Asignado",recogido:"Recogido",en_ruta:"En camino",entregado:"Entregado",cancelado:"Cancelado"};
const labelFlags={realOrders:"Pedidos reales",sendSms:"Envíos de SMS",publishGps:"GPS de clientes",automaticDispatch:"Asignación automática",modifyPayments:"Modificar cobros"};
const state={count:18,riderCount:4,waiting:20,scenario:"normal",countedCash:null};
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clock=()=>Date.now();
function render(){
 const now=clock();
 const data=sampleData({now,count:state.count,riderCount:state.riderCount,scenario:state.scenario});
 const operational=summarizeOperations(data.orders,data.riders,now,state.waiting);
 const financial=summarizeFinance(data.orders,state.countedCash);
 const riderStats=summarizeRiders(data.orders,data.riders);
 byId("orderOutput").textContent=String(state.count);
 byId("riderOutput").textContent=String(state.riderCount);
 byId("waitingOutput").textContent=String(state.waiting)+" min";
 byId("total").textContent=String(operational.total);
 byId("active").textContent=String(operational.active);
 byId("delivered").textContent=String(operational.delivered);
 byId("alertsCount").textContent=String(operational.alerts.length);
 byId("alertBadge").textContent=operational.alerts.length+" avisos de prueba";
 const alertList=operational.alerts.slice(0,10);
 byId("alerts").innerHTML=alertList.length?alertList.map(a=>
  '<div class="alert '+(a.level==="critical"?"critical":"warning")+'"><span class="alert-dot" aria-hidden="true"></span><div><strong>'+
   escapeHtml(a.ref)+'</strong><small>'+escapeHtml(a.text)+'</small></div></div>').join(""):'<p class="empty">Sin incidencias en este escenario ficticio.</p>';
 if(operational.alerts.length>10){
  const p=document.createElement("p");p.className="muted small";p.textContent="Otros "+(operational.alerts.length-10)+" avisos omitidos de la vista resumida.";
  byId("alerts").append(p);
 }
 byId("totalSales").textContent=euros(financial.totalCents);
 byId("cash").textContent=euros(financial.cashCents);
 byId("card").textContent=euros(financial.cardCents);
 byId("unknown").textContent=euros(financial.unclassifiedCents);
 byId("difference").textContent=financial.cashDifferenceCents===null?"Sin efectivo contado":
  "Diferencia de ejemplo: "+euros(financial.cashDifferenceCents);
 byId("difference").className="difference "+(financial.cashDifferenceCents!==null&&financial.cashDifferenceCents!==0?"caution":"");
 byId("riderRows").innerHTML=riderStats.map(r=>
  "<tr><td><strong>"+escapeHtml(r.label)+"</strong></td><td>"+r.active+"</td><td>"+r.delivered+
  "</td><td>"+(r.averageMinutes===null?"—":r.averageMinutes+" min")+"</td></tr>").join("");
 const example=data.orders.find(o=>o.status==="en_ruta")||data.orders[0];
 const customer=customerView(example,now);
 byId("customerRef").textContent=customer.reference;
 byId("customerStatus").textContent=labelStatus[customer.status]||"Estado sin confirmar";
 byId("customerProgress").style.width=String(customer.progress)+"%";
 byId("customerSteps").innerHTML=customer.steps.map(s=>
  '<li class="'+(s.done?"done":"")+'"><span aria-hidden="true">'+(s.done?"✓":"○")+"</span>"+escapeHtml(labelStatus[s.name])+"</li>").join("");
 byId("customerEta").textContent=customer.routeValid?
  "Ruta validada: "+customer.route.distanceKm.toFixed(1)+" km y "+Math.ceil(customer.route.durationMinutes)+" min estimados":
  "Tiempo de llegada no disponible: faltan datos de ruta reales, frescos y autorizados.";
 byId("safetyFlags").innerHTML=Object.entries(SAFETY_FLAGS).map(([name,enabled])=>
  '<div class="flag"><span>'+escapeHtml(labelFlags[name])+'</span><strong class="'+(enabled?"on":"off")+'">'+(enabled?"ACTIVO":"DESACTIVADO")+"</strong></div>").join("");
}
for(const [id,key] of [["orderCount","count"],["riderCount","riderCount"],["waiting","waiting"]]){
 byId(id).addEventListener("input",event=>{state[key]=Number(event.target.value);render();});
}
byId("scenario").addEventListener("change",event=>{state.scenario=event.target.value;render();});
byId("cashCounted").addEventListener("input",event=>{
 const raw=event.target.value;
 const n=Number(raw);
 state.countedCash=raw.trim()!==""&&Number.isFinite(n)&&n>=0&&n<=10000000?Math.round(n*100):null;
 render();
});
render();
