// Estambul Labs — pure calculations over synthetic or explicitly supplied records.
// No network requests, persistence, service credentials, or database writes.
export const SAFETY_FLAGS = Object.freeze({
  realOrders: false,
  sendSms: false,
  publishGps: false,
  automaticDispatch: false,
  modifyPayments: false
});
export const STATUSES = Object.freeze(["pendiente","asignado","recogido","en_ruta","entregado","cancelado"]);
const ACTIVE = new Set(["pendiente","asignado","recogido","en_ruta"]);
const PAYMENT = new Set(["efectivo","tarjeta"]);
const MINUTE = 60000;
const isDate = n => Number.isFinite(Number(n)) && Number(n) > 0;
const amount = order => Number.isSafeInteger(order.amountCents) && order.amountCents >= 0 ? order.amountCents : 0;
export const euros = cents => new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(cents/100);

export function sampleData(options={}) {
  const now=Number(options.now ?? Date.now());
  const count=Math.max(1,Math.min(60,Math.trunc(Number(options.count ?? 18))||18));
  const riderCount=Math.max(1,Math.min(12,Math.trunc(Number(options.riderCount ?? 4))||4));
  const scenario=["normal","peak","gps","payment"].includes(options.scenario)?options.scenario:"normal";
  const riders=Array.from({length:riderCount},(_,i)=>({
    id:"R"+String(i+1).padStart(2,"0"),label:"Rider "+(i+1),available:i!==riderCount-1
  }));
  const channels=["lastapp","gloriafood","uber","justeat"];
  const statuses=scenario==="peak"
    ?["pendiente","asignado","en_ruta","pendiente","recogido","entregado"]
    :["pendiente","asignado","recogido","en_ruta","entregado","entregado"];
  const orders=Array.from({length:count},(_,i)=>{
    const status=statuses[i%statuses.length];
    const minutesOld=14+(i*11)%76;
    const age=status==="entregado"?Math.max(40,minutesOld):minutesOld;
    const createdAt=now-age*MINUTE;
    const dueAt=createdAt+32*MINUTE;
    const hasGps=status==="en_ruta";
    const gpsAt=hasGps?now-(scenario==="gps"?180000:(i%3===0?90000:19000)):null;
    const method=(scenario==="payment"&&i%3===0)||(i%10===0)?"":(i%2===0?"efectivo":"tarjeta");
    return {
      id:"D"+String(i+1).padStart(3,"0"),
      reference:"DEMO-"+String(2001+i),
      source:channels[i%channels.length],
      externalId:"EX-"+(2001+i),
      status,
      riderId:status==="pendiente"?null:riders[i%riderCount].id,
      amountCents:1190+(i%8)*325,
      paymentMethod:method,
      createdAt,dueAt,
      deliveredAt:status==="entregado"?createdAt+Math.min(age,37)*MINUTE:null,
      gpsOptIn:hasGps,
      gpsAt,
      route:null
    };
  });
  return {riders,orders,now,scenario};
}

export function summarizeFinance(orders,countedCashCents=null) {
  const delivered=orders.filter(o=>o.status==="entregado");
  let totalCents=0,cashCents=0,cardCents=0,unclassifiedCents=0;
  for(const o of delivered){
    const value=amount(o);
    totalCents+=value;
    if(o.paymentMethod==="efectivo")cashCents+=value;
    else if(o.paymentMethod==="tarjeta")cardCents+=value;
    else unclassifiedCents+=value;
  }
  const counted=Number.isSafeInteger(countedCashCents)&&countedCashCents>=0?countedCashCents:null;
  return {deliveredCount:delivered.length,totalCents,cashCents,cardCents,unclassifiedCents,
    cashDifferenceCents:counted===null?null:counted-cashCents,
    warning:"Simulación operativa. No es un arqueo fiscal ni modifica cobros."};
}

export function summarizeRiders(orders,riders) {
  return riders.map(rider=>{
    const mine=orders.filter(o=>o.riderId===rider.id);
    const delivered=mine.filter(o=>o.status==="entregado");
    const durations=delivered.filter(o=>isDate(o.createdAt)&&isDate(o.deliveredAt)&&o.deliveredAt>=o.createdAt)
      .map(o=>(o.deliveredAt-o.createdAt)/MINUTE);
    return {id:rider.id,label:rider.label,available:!!rider.available,
      active:mine.filter(o=>ACTIVE.has(o.status)).length,
      delivered:delivered.length,
      averageMinutes:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):null};
  });
}

export function summarizeOperations(orders,riders,now,waitingThreshold=20) {
  const alerts=[],seen=new Set();
  const threshold=Math.max(5,Math.min(120,Number(waitingThreshold)||20));
  for(const o of orders){
    if(!STATUSES.includes(o.status))continue;
    const ref=String(o.reference||o.id||"Pedido");
    if(o.source&&o.externalId){
      const key=String(o.source)+"|"+String(o.externalId);
      if(seen.has(key))alerts.push({level:"critical",type:"duplicate",ref,text:"Posible duplicado de origen"});
      seen.add(key);
    }
    if(o.status==="pendiente"&&!o.riderId&&isDate(o.createdAt)&&now-o.createdAt>threshold*MINUTE)
      alerts.push({level:"critical",type:"unassigned",ref,text:"Pedido pendiente sin rider"});
    if(ACTIVE.has(o.status)&&isDate(o.dueAt)&&now>o.dueAt)
      alerts.push({level:"warning",type:"late",ref,text:"Hora objetivo superada"});
    if(o.status==="en_ruta"&&o.gpsOptIn&&(!isDate(o.gpsAt)||now-o.gpsAt>45000||now<o.gpsAt))
      alerts.push({level:"warning",type:"gps",ref,text:"GPS no reciente; ocultar posición"});
    if(o.status==="entregado"&&!PAYMENT.has(o.paymentMethod))
      alerts.push({level:"warning",type:"payment",ref,text:"Pago sin clasificar"});
  }
  const level={critical:0,warning:1,info:2};
  alerts.sort((a,b)=>level[a.level]-level[b.level]||a.ref.localeCompare(b.ref));
  const active=orders.filter(o=>ACTIVE.has(o.status));
  return {total:orders.length,active:active.length,delivered:orders.filter(o=>o.status==="entregado").length,
    availableRiders:riders.filter(r=>r.available).length,alerts};
}

export function customerView(order,now) {
  const index=STATUSES.indexOf(order.status);
  const steps=["pendiente","asignado","recogido","en_ruta","entregado"];
  const gpsRecent=order.status==="en_ruta"&&order.gpsOptIn===true&&isDate(order.gpsAt)&&
    now>=order.gpsAt&&now-order.gpsAt<=45000;
  const route=order.route;
  const routeValid=gpsRecent&&route?.validated===true&&Number.isFinite(route.distanceKm)&&
    Number.isFinite(route.durationMinutes)&&route.distanceKm>=0&&route.durationMinutes>=0&&
    isDate(route.calculatedAt)&&now>=route.calculatedAt&&now-route.calculatedAt<=120000;
  return {status:order.status,reference:String(order.reference||"DEMO"),
    progress:order.status==="cancelado"?0:Math.round((Math.max(0,steps.indexOf(order.status))+1)/steps.length*100),
    steps:steps.map((name,i)=>({name,done:index>=0&&index>=i&&order.status!=="cancelado"})),
    gpsRecent,routeValid,route:routeValid?route:null,
    information:"Vista de laboratorio: ningún GPS real se recoge o transmite."};
}
