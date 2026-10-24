// Credentials are encrypted with AES-GCM under a server-only key. Never returned by the API.
export async function credentialStore(db,environment){
 const material=environment('DM_ENCRYPTION_KEY')||environment('SUPABASE_SERVICE_ROLE_KEY');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(material));
 const key=await crypto.subtle.importKey('raw',digest,'AES-GCM',false,['encrypt','decrypt']);
 const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
 const encode=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
 const {data,error}=await db.from('dm_credentials').select('name,iv,cipher');
 if(error)throw Error('credential_store_unavailable');
 const values={};
 for(const row of data||[]){try{const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(row.iv),additionalData:new TextEncoder().encode(row.name)},key,decode(row.cipher));values[row.name]=new TextDecoder().decode(raw);}catch{}}
 return {env:name=>values[name]||environment(name),save:async entries=>{
  const rows=[];
  for(const [name,value] of Object.entries(entries)){const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(name)},key,new TextEncoder().encode(value));rows.push({name,iv:encode(iv),cipher:encode(cipher)});}
  const {error}=await db.from('dm_credentials').upsert(rows);if(error)throw Error('credential_store_unavailable');
 }};
}
