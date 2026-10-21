import * as SecureStore from "expo-secure-store";

// Only a Rider's email identifier is cached in the device Keychain/Keystore.
// Passwords and order data are never stored by this convenience feature.
const key = (slot:number)=>"ed-rider-email-slot-"+slot;
export const RIDER_SLOTS = [1,2,3,4,5,6] as const;
export function validRiderSlot(slot:number):boolean{
 return Number.isInteger(slot)&&slot>=1&&slot<=6;
}
export function riderSlotFromName(name:string):number|null{
 const found=String(name||"").trim().match(/^rider[\s_-]*0?([1-6])$/i);
 return found?Number(found[1]):null;
}
export async function savedRiderEmail(slot:number):Promise<string>{
 if(!validRiderSlot(slot))return "";
 try{return await SecureStore.getItemAsync(key(slot))||"";}catch{return "";}
}
export async function saveRiderEmail(slot:number,email:string):Promise<void>{
 const value=email.trim().toLowerCase();
 if(!validRiderSlot(slot)||!/^\S+@\S+\.\S+$/.test(value))throw new Error("Correo Rider inválido");
 await SecureStore.setItemAsync(key(slot),value);
}
export async function clearRiderEmail(slot:number):Promise<void>{
 if(validRiderSlot(slot))await SecureStore.deleteItemAsync(key(slot));
}
