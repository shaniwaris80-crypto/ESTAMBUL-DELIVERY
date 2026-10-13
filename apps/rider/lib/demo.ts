import { seedOrders, seedRiders, type DeliveryOrder, type DeliveryStatus, type DemoState } from "@estambul/shared";

const api = process.env.EXPO_PUBLIC_DEMO_API_URL?.replace(/\/$/, "");
function initialState():DemoState {
  return { demo:true,riders:structuredClone(seedRiders),orders:structuredClone(seedOrders),updatedAt:new Date().toISOString() };
}
let localState: DemoState = initialState();
export const isRemoteDemo = Boolean(api);
export async function loadDemo():Promise<DemoState> {
  if(!api) return structuredClone(localState);
  const r=await fetch(api,{headers:{"Accept":"application/json"}});
  if(!r.ok) throw new Error("El servidor de pruebas no responde");
  return await r.json() as DemoState;
}
export async function updateDemoStatus(orderId:string,status:DeliveryStatus):Promise<DemoState> {
  if(api){
    const r=await fetch(api,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"status",orderId,status})});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error??"No se pudo actualizar");
    return data as DemoState;
  }
  const order=localState.orders.find(o=>o.id===orderId);
  if(!order||!order.riderId) throw new Error("Pedido no asignado");
  if(order.status==="entregado") throw new Error("Pedido ya entregado");
  order.status=status;
  localState.updatedAt=new Date().toISOString();
  return structuredClone(localState);
}
export function openDirections(order:DeliveryOrder) {
  return "https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(order.lat+","+order.lng)+"&travelmode=driving";
}
