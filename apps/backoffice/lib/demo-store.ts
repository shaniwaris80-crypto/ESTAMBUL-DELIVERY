import { seedRiders, seedOrders, type DemoCommand, type DemoState, type DeliveryStatus } from "@estambul/shared";
// Memoria efímera para DEMO local: se reinicia con el servidor. No es base de datos real.
let state: DemoState = createState();
function createState(): DemoState { return { riders: structuredClone(seedRiders), orders: structuredClone(seedOrders), updatedAt: new Date().toISOString(), demo: true }; }
export function snapshot(): DemoState { return structuredClone(state); }
function error(message:string):never { throw new Error(message); }
const statuses: DeliveryStatus[] = ["pendiente","asignado","recogido","en_ruta","entregado"];
export function execute(command: DemoCommand): DemoState {
  if(command.action === "reset") { state=createState(); return snapshot(); }
  if(command.action === "addRider") { const name=command.name?.trim(); if(!name || name.length>60) error("Nombre de rider inválido"); if(state.riders.some(r=>r.active&&r.name.toLowerCase()===name.toLowerCase()))error("Ya existe un rider con ese nombre");state.riders.push({id:`r-demo-${Date.now()}`,name,active:true,online:false,lat:42.35,lng:-3.68}); }
  else if(command.action === "toggleRider") {const rider=state.riders.find(r=>r.id===command.riderId); if(!rider)error("Rider inexistente"); rider.active=!rider.active; if(!rider.active){rider.online=false;state.orders.forEach(o=>{if(o.riderId===rider.id&&o.status!=="entregado"){o.riderId=null;o.status="pendiente";}});} }
  else if(command.action === "moveDemo") {const rider=state.riders.find(r=>r.id===command.riderId);if(!rider||!rider.active)error("Rider inválido");rider.lat+=0.0008;rider.lng-=0.0005; }
  else if(command.action === "assign") {const order=state.orders.find(o=>o.id===command.orderId);if(!order)error("Pedido inexistente");if(order.status==="entregado")error("Pedido ya entregado");if(command.riderId!==null&&!state.riders.some(r=>r.id===command.riderId&&r.active))error("Rider no disponible");order.riderId=command.riderId;order.status=command.riderId?"asignado":"pendiente";}
  else if(command.action === "status") {const order=state.orders.find(o=>o.id===command.orderId);if(!order)error("Pedido inexistente");if(!statuses.includes(command.status))error("Estado inválido");if(command.status!=="pendiente"&&!order.riderId)error("Asigna un rider primero");order.status=command.status;}
  else { error("Acción no reconocida"); }
  state.updatedAt=new Date().toISOString();return snapshot();
}
