/** DEMO ONLY — personas, pedidos y coordenadas de ejemplo. */
export type Channel = "lastapp" | "uber" | "justeat";
export type DeliveryStatus = "pendiente" | "asignado" | "recogido" | "en_ruta" | "entregado";
export type Rider = { id: string; name: string; active: boolean; online: boolean; lat: number; lng: number; phone?: string };
export type DeliveryOrder = { id: string; channel: Channel; customer: string; address: string; lat: number; lng: number; riderId: string | null; status: DeliveryStatus; amount: number; notes: string };
export type DemoState = { riders: Rider[]; orders: DeliveryOrder[]; updatedAt: string; demo: true };
export type DemoCommand =
  | { action: "assign"; orderId: string; riderId: string | null }
  | { action: "status"; orderId: string; status: DeliveryStatus }
  | { action: "addRider"; name: string }
  | { action: "toggleRider"; riderId: string }
  | { action: "moveDemo"; riderId: string }
  | { action: "reset" };
export const channelLabels: Record<Channel, string> = { lastapp: "Last.app", uber: "Uber Eats", justeat: "Just Eat" };
export const statusLabels: Record<DeliveryStatus, string> = { pendiente: "Pendiente", asignado: "Asignado", recogido: "Recogido", en_ruta: "En reparto", entregado: "Entregado" };
export const seedRiders: Rider[] = [
  { id: "r-a", name: "Rider A", active: true, online: true, lat: 42.3501, lng: -3.6627 },
  { id: "r-b", name: "Rider B", active: true, online: true, lat: 42.3426, lng: -3.6819 },
  { id: "r-c", name: "Rider C", active: true, online: false, lat: 42.3461, lng: -3.6932 },
  { id: "r-d", name: "Rider D", active: true, online: true, lat: 42.3615, lng: -3.6682 }
];
export const seedOrders: DeliveryOrder[] = [
  { id: "ED-1001", channel: "lastapp", customer: "Cliente A", address: "Punto de prueba · Gamonal", lat: 42.3555, lng: -3.6666, riderId: "r-a", status: "en_ruta", amount: 23.40, notes: "Pedido ficticio" },
  { id: "ED-1002", channel: "uber", customer: "Cliente B", address: "Punto de prueba · Centro", lat: 42.3431, lng: -3.6971, riderId: "r-b", status: "asignado", amount: 17.80, notes: "Pedido ficticio" },
  { id: "ED-1003", channel: "justeat", customer: "Cliente C", address: "Punto de prueba · Río Vena", lat: 42.3465, lng: -3.6727, riderId: "r-a", status: "recogido", amount: 31.25, notes: "Pedido ficticio" },
  { id: "ED-1004", channel: "lastapp", customer: "Cliente D", address: "Punto de prueba · San Pedro", lat: 42.3374, lng: -3.7221, riderId: null, status: "pendiente", amount: 19.90, notes: "Pedido ficticio" },
  { id: "ED-1005", channel: "uber", customer: "Cliente E", address: "Punto de prueba · Capiscol", lat: 42.3587, lng: -3.6435, riderId: "r-d", status: "en_ruta", amount: 28.60, notes: "Pedido ficticio" },
  { id: "ED-1006", channel: "justeat", customer: "Cliente F", address: "Punto de prueba · San Lesmes", lat: 42.3444, lng: -3.6902, riderId: null, status: "pendiente", amount: 12.50, notes: "Pedido ficticio" },
  { id: "ED-1007", channel: "lastapp", customer: "Cliente G", address: "Punto de prueba · Plaza Mayor", lat: 42.3406, lng: -3.7015, riderId: "r-b", status: "entregado", amount: 25.00, notes: "Pedido ficticio" }
];
