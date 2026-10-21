/* Back Office email recovery. Does not handle or persist any Rider credentials.
 * No service role key, no automatic emails and no password logging. */
(()=>{
 "use strict";
 const root=window.ESTAMBUL_SUPABASE||{};
 const base=String(root.url||"").replace(/\/+$/,"");
 const key=String(root.anonKey||"");
 const ready=/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)&&key.length>20;
 const $=id=>document.getElementById(id);
 let recoveryAccess=null;
 let recoveryBusy=false;
 const headers=()=>({"apikey":key,"Content-Type":"application/json"});
 async function parse(response){
   const value=await response.text();let json=null;
   try{json=value?JSON.parse(value):null;}catch{}
   if(!response.ok)throw Error(json?.error_description||json?.message||"Servicio de correo no disponible ("+response.status+").");
   return json;
 }
 function note(message,error=false){
   const box=$("recoveryEmailStatus");
   if(!box)return;
   box.textContent=message;box.hidden=false;
   box.classList.toggle("error",error);
 }
 async function initialise(){
   if(!ready)return false;
   const hash=new URLSearchParams(window.location.hash.replace(/^#/,""));
   const search=new URLSearchParams(window.location.search);
   if(hash.get("type")!=="recovery"&&search.get("type")!=="recovery")return false;
   let access=hash.get("access_token");
   // Never leave recovery tokens in the URL while making network calls.
   window.history.replaceState(null,"",window.location.pathname);
   try{
     if(!access&&search.get("token_hash")){
       const verified=await parse(await fetch(base+"/auth/v1/verify",{
         method:"POST",headers:headers(),cache:"no-store",referrerPolicy:"no-referrer",
         body:JSON.stringify({type:"recovery",token_hash:search.get("token_hash")})
       }));
       access=verified?.access_token;
     }
     if(typeof access!=="string"||access.length<40||access.length>8192)
       throw Error("Enlace de recuperación inválido o caducado.");
     const authorization="Bearer "+access;
     const user=await parse(await fetch(base+"/auth/v1/user",{
       method:"GET",headers:{"apikey":key,Authorization:authorization},
       cache:"no-store",referrerPolicy:"no-referrer"
     }));
     if(!user?.id)throw Error("No se pudo confirmar la sesión de recuperación.");
     const membership=await parse(await fetch(base+"/rest/v1/ed_members?select=role&user_id=eq."+
       encodeURIComponent(user.id)+"&active=eq.true",{
       headers:{"apikey":key,Authorization:authorization},
       cache:"no-store",referrerPolicy:"no-referrer"
     }));
     if(!Array.isArray(membership)||!membership.some(m=>m.role==="admin"||m.role==="dispatcher"))
       throw Error("Esta recuperación no corresponde a una cuenta de Back Office.");
     recoveryAccess=access;
     window.sessionStorage.removeItem("estambul-secure-test-session");
     $("loginSection").hidden=false;
     $("loginForm").hidden=true;
     $("passwordRecoveryForm").hidden=false;
     if(user.email)$("email").value=user.email;
     $("recoveryNewPassword").focus();
   }catch(e){
     recoveryAccess=null;
     $("loginSection").hidden=false;
     $("loginForm").hidden=false;
     $("passwordRecoveryForm").hidden=true;
     note((e instanceof Error?e.message:"No se pudo validar el enlace")+
       " Solicita un nuevo enlace desde el acceso.",true);
   }
   return true;
 }
 $("forgotPasswordButton")?.addEventListener("click",async()=>{
   const email=$("email");
   if(!ready){note("La conexión de Supabase no está disponible.",true);return;}
   if(!email.value.trim()||!email.checkValidity()){email.reportValidity();return;}
   const button=$("forgotPasswordButton");
   button.disabled=true;
   note("Solicitando recuperación por correo…");
   try{
     const redirect=window.location.origin+window.location.pathname;
     await parse(await fetch(base+"/auth/v1/recover?redirect_to="+encodeURIComponent(redirect),{
       method:"POST",headers:headers(),cache:"no-store",referrerPolicy:"no-referrer",
       body:JSON.stringify({email:email.value.trim().toLowerCase()})
     }));
     note("Si esta dirección pertenece a una cuenta autorizada, recibirás un enlace para cambiar la contraseña. Revisa también spam.");
   }catch(e){
     note(e instanceof Error?e.message:"No fue posible solicitar el correo. Revisa la configuración SMTP y los límites de Supabase.",true);
     button.disabled=false;
   }
 });
 $("passwordRecoveryForm")?.addEventListener("submit",async event=>{
   event.preventDefault();
   if(recoveryBusy)return;
   const password=$("recoveryNewPassword").value;
   const repeated=$("recoveryConfirmPassword").value;
   const status=$("recoverySubmitStatus");
   status.hidden=false;
   if(!recoveryAccess||password.length<10||password!==repeated){
     status.textContent="El enlace debe ser válido y las dos contraseñas deben coincidir (mínimo 10 caracteres).";
     return;
   }
   recoveryBusy=true;
   $("recoverySaveButton").disabled=true;
   status.textContent="Actualizando contraseña…";
   try{
     await parse(await fetch(base+"/auth/v1/user",{
       method:"PUT",
       headers:{...headers(),Authorization:"Bearer "+recoveryAccess},
       body:JSON.stringify({password}),cache:"no-store",referrerPolicy:"no-referrer"
     }));
     recoveryAccess=null;
     $("recoveryNewPassword").value="";
     $("recoveryConfirmPassword").value="";
     $("passwordRecoveryForm").hidden=true;
     $("loginForm").hidden=false;
     $("password").value="";
     note("Contraseña actualizada. Inicia sesión con la nueva contraseña.");
   }catch(e){
     status.textContent=e instanceof Error?e.message:"No se pudo actualizar. Solicita un nuevo enlace.";
   }finally{
     recoveryBusy=false;
     $("recoverySaveButton").disabled=false;
   }
 });
 window.ESTAMBUL_ADMIN_RECOVERY=Object.freeze({initialise});
})();