/* Estambul Rider PRO — local shortcuts. Stores email identifiers only, never passwords.
 * Authentication and role validation remain exclusively in Supabase Auth/RLS. */
(function(root){
 "use strict";
 const prefix="estambul-rider-profile-email-v1:";
 const emailPattern=/^[^\s@]{1,128}@[^\s@]{1,255}$/;
 const slotNumber=value=>{
  const n=Number(value);
  return Number.isInteger(n)&&n>=1&&n<=6?n:null;
 };
 const slotForName=name=>{
  const match=String(name||"").trim().match(/^rider[\s_-]*0?([1-6])$/i);
  return match?Number(match[1]):null;
 };
 function readEmail(slot){
  const n=slotNumber(slot);if(!n)return "";
  try {const value=root.localStorage?.getItem(prefix+n)||"";return emailPattern.test(value)?value:"";}catch{return "";}
 }
 function rememberEmail(slot,email){
  const n=slotNumber(slot),value=String(email||"").trim().toLowerCase();
  if(!n||!emailPattern.test(value))return false;
  try{root.localStorage?.setItem(prefix+n,value);return true;}catch{return false;}
 }
 function forgetEmail(slot){
  const n=slotNumber(slot);if(!n)return;
  try{root.localStorage?.removeItem(prefix+n);}catch{}
 }
 const profiles=Object.freeze(Array.from({length:6},(_,i)=>Object.freeze({slot:i+1,label:"RIDER "+String(i+1).padStart(2,"0")})));
 root.ESTAMBUL_RIDER_PROFILES=Object.freeze({profiles,slotForName,readEmail,rememberEmail,forgetEmail});
})(typeof window!=="undefined"?window:globalThis);
