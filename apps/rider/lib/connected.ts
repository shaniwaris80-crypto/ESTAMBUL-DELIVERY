import * as SecureStore from "expo-secure-store";
import type { DeliveryStatus } from "@estambul/shared";

const base=(process.env.EXPO_PUBLIC_SUPABASE_URL||"").replace(/\/+$/,"");
const apikey=process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY||"";
export const isConnectedConfigured=base.startsWith("https://")&&apikey.length>20;
const storageKey="estambul-connected-session";
type Session={access_token:string;refresh_token:string;expires:number};
let session:Session|null=null;
type User={id:string};
export type RiderOrder={id:string;reference:string;customer_name:string;customer_phone:string|null;notes:string;destination:string;channel:string;status:DeliveryStatus|"cancelado";rider_id:string|null;lat:number|null;lng:number|null;amount:number;};
export type ConnectedRider={id:string;display_name:string;online:boolean;active:boolean;user_id:string;};
export type ConnectedState={rider:ConnectedRider;orders:RiderOrder[];account:string};

function configHeaders(){return {"apikey":apikey,"Content-Type":"application/json"}}
async function parse(res:Response):Promise<any>{
 const raw=await res.text();let json:any=null;
 try{json=raw?JSON.parse(raw):null;}catch{json=raw;}
 if(!res.ok)throw new Error(json?.message||json?.error_description||json?.error||"Error de conexión "+res.status);
 return json;
}
async function persist(value:Session|null){session=value;if(value)await SecureStore.setItemAsync(storageKey,JSON.stringify(value));else await SecureStore.deleteItemAsync(storageKey);}
export async function restoreSession(){if(session)return true;const stored=await SecureStore.getItemAsync(storageKey);try{session=stored?JSON.parse(stored) as Session:null;}catch{session=null;}return Boolean(session);}
async function token():Promise<string>{
 if(!session)await restoreSession();if(!session)throw new Error("Inicia sesión.");
 if(!session.expires||Date.now()>session.expires-60000){
  const data=await parse(await fetch(base+"/auth/v1/token?grant_type=refresh_token",{method:"POST",headers:configHeaders(),body:JSON.stringify({refresh_token:session.refresh_token})}));
  await persist({access_token:data.access_token,refresh_token:data.refresh_token,expires:Date.now()+data.expires_in*1000});
 }
 return session!.access_token;
}
async function request(path:string,options:RequestInit={}):Promise<any>{
 let auth=await token();
 const headers={...configHeaders(),Authorization:"Bearer "+auth,...(options.headers||{})};
 let resp=await fetch(base+path,{...options,headers});
 if(resp.status===401){
  if(!session)throw new Error("Sesión expirada");
  const data=await parse(await fetch(base+"/auth/v1/token?grant_type=refresh_token",{method:"POST",headers:configHeaders(),body:JSON.stringify({refresh_token:session.refresh_token})}));
  await persist({access_token:data.access_token,refresh_token:data.refresh_token,expires:Date.now()+data.expires_in*1000});
  auth=session!.access_token;headers.Authorization="Bearer "+auth;
  resp=await fetch(base+path,{...options,headers});
 }
 return parse(resp);
}
export async function loginRider(email:string,password:string){
 if(!isConnectedConfigured)throw new Error("No está configurado Supabase.");
 const data=await parse(await fetch(base+"/auth/v1/token?grant_type=password",{method:"POST",headers:configHeaders(),body:JSON.stringify({email,password})}));
 await persist({access_token:data.access_token,refresh_token:data.refresh_token,expires:Date.now()+data.expires_in*1000});
}
export async function logoutRider(){await persist(null);}
export async function loadConnected():Promise<ConnectedState>{
 const user=await request("/auth/v1/user") as User;
 let memberships=await request("/rest/v1/ed_members?select=account_id,role&user_id=eq."+encodeURIComponent(user.id)+"&active=eq.true") as {account_id:string;role:string}[];
 let membership=memberships.find(m=>m.role==="rider");
 if(!membership){
  await request("/rest/v1/rpc/ed_activate_rider",{method:"POST",body:"{}"});
  memberships=await request("/rest/v1/ed_members?select=account_id,role&user_id=eq."+encodeURIComponent(user.id)+"&active=eq.true") as {account_id:string;role:string}[];
  membership=memberships.find(m=>m.role==="rider");
  if(!membership)throw new Error("El usuario no tiene una invitación de Rider válida.");
 }
 const riders=await request("/rest/v1/ed_riders?select=id,display_name,online,active,user_id&account_id=eq."+membership.account_id) as ConnectedRider[];
 const rider=riders.find(r=>r.user_id===user.id&&r.active);
 if(!rider)throw new Error("No hay un rider activo vinculado a esta cuenta.");
 const orders=await request("/rest/v1/ed_orders?select=id,reference,customer_name,customer_phone,notes,destination,channel,status,rider_id,lat,lng,amount&account_id=eq."+membership.account_id+"&rider_id=eq."+rider.id+"&order=created_at.desc&limit=100") as RiderOrder[];
 return {rider,orders,account:membership.account_id};
}
export async function advanceDelivery(order:RiderOrder,next:DeliveryStatus){
 const old=order.status;if(!({asignado:"recogido",recogido:"en_ruta",en_ruta:"entregado"} as Record<string,string>)[old]||({asignado:"recogido",recogido:"en_ruta",en_ruta:"entregado"} as Record<string,string>)[old]!==next)throw new Error("Transición inválida.");
 const path="/rest/v1/ed_orders?id=eq."+order.id+"&rider_id=eq."+order.rider_id+"&status=eq."+old;
 const rows=await request(path,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({status:next})});
 if(!Array.isArray(rows)||rows.length!==1)throw new Error("El pedido fue reasignado o modificado. Actualiza.");
}
export async function setRiderOnline(id:string,online:boolean){
 const rows=await request("/rest/v1/ed_riders?id=eq."+encodeURIComponent(id),{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({online})});
 if(!Array.isArray(rows)||rows.length!==1)throw new Error("No se pudo cambiar disponibilidad.");
}
