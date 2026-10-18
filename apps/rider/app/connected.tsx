import { useCallback,useEffect,useRef,useState } from "react";
import { Alert, ActivityIndicator, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import type { DeliveryStatus } from "@estambul/shared";
import { advanceDelivery, isConnectedConfigured, connectedItemFeature, loadConnected, loginRider, logoutRider, restoreSession, setRiderOnline, type ConnectedState, type RiderOrder } from "../lib/connected";
import {RIDER_SLOTS,savedRiderEmail,saveRiderEmail,clearRiderEmail,riderSlotFromName} from "../lib/rider-profiles";

const palette={dark:"#10243a",orange:"#ed9944",green:"#139b78",muted:"#6d8195",bg:"#f2f5fa"};
const next:{[key:string]:DeliveryStatus}={asignado:"recogido",recogido:"en_ruta",en_ruta:"entregado"};
const nextLabel:{[key:string]:string}={recogido:"Confirmar recogida",en_ruta:"Iniciar reparto",entregado:"Confirmar entrega"};
function waiting(order:RiderOrder):number{
 const ms=Date.parse(order.created_at);
 return Number.isFinite(ms)?Math.max(0,Math.min(1440,Math.floor((Date.now()-ms)/60000))):0;
}
function geoDistance(a:RiderOrder,b:RiderOrder):number{
 if(a.lat==null||a.lng==null||b.lat==null||b.lng==null)return Number.POSITIVE_INFINITY;
 const d=Math.PI/180;
 const dlat=(a.lat-b.lat)*d,dlng=(a.lng-b.lng)*d;
 const h=Math.sin(dlat/2)**2+Math.cos(a.lat*d)*Math.cos(b.lat*d)*Math.sin(dlng/2)**2;
 return 6371*2*Math.asin(Math.min(1,Math.sqrt(h)));
}
function suggestRoute(orders:RiderOrder[]):RiderOrder[]{
 const pending=orders.slice().sort((a,b)=>(a.status==="en_ruta"?0:1)-(b.status==="en_ruta"?0:1)
    || waiting(b)-waiting(a));
 if(pending.length<3||pending.some(o=>o.lat==null||o.lng==null))return pending;
 const result=[pending.shift()!];let travel=0;
 while(pending.length){
  const last=result[result.length-1];let best=0,bestScore=Infinity;
  pending.forEach((o,i)=>{
   const mins=geoDistance(last,o)/18*60;
   const lateness=waiting(o)+travel+mins;
   const score=mins+Math.max(0,lateness-18)*1.3+Math.max(0,lateness-30)*3.5;
   if(score<bestScore){bestScore=score;best=i;}
  });
  const nextStop=pending.splice(best,1)[0];
  travel+=geoDistance(last,nextStop)/18*60+2;
  result.push(nextStop);
 }
 return result;
}
function directions(order:RiderOrder){
 if(order.lat!=null&&order.lng!=null)return order.lat+","+order.lng;
 const text=String(order.destination||"").trim();
 return /burgos|españa|spain/i.test(text)?text:text+", Burgos, España";
}
function routeLinks(orders:RiderOrder[]):string[]{
 const out:string[]=[];let pos=0,previous:RiderOrder|null=null;
 while(pos<orders.length){
  const group=orders.slice(pos,pos+(previous?3:4));
  if(!group.length)break;
  const last=group[group.length-1];
  const parts=["api=1","destination="+encodeURIComponent(directions(last)),"travelmode=driving"];
  if(previous)parts.push("origin="+encodeURIComponent(directions(previous)));
  const waypoints=group.slice(0,-1).map(directions);
  if(waypoints.length)parts.push("waypoints="+encodeURIComponent(waypoints.join("|")));
  out.push("https://www.google.com/maps/dir/?"+parts.join("&"));
  previous=last;pos+=group.length;
 }
 return out;
}
export default function Connected(){
 const [email,setEmail]=useState(""),[password,setPassword]=useState("");
 const [slot,setSlot]=useState<number|null>(null),[remembered,setRemembered]=useState(false);
 const slotRequest=useRef(0);
 async function chooseSlot(value:number){
  const request=++slotRequest.current;
  setSlot(value);setPassword("");setError("");
  const saved=await savedRiderEmail(value);
  if(request!==slotRequest.current)return;
  setEmail(saved);setRemembered(Boolean(saved));
 }
 async function forgetSlot(){if(slot===null)return;await clearRiderEmail(slot);setEmail("");setRemembered(false);setPassword("");}
 const [signed,setSigned]=useState(false),[data,setData]=useState<ConnectedState|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const refresh=useCallback(async()=>{const d=await loadConnected();setData(d);setSigned(true);setError("");},[]);
 useEffect(()=>{if(!isConnectedConfigured)return;let active=true;
  void restoreSession().then(async ok=>{if(ok&&active)try{await refresh()}catch(e){if(active)setError(e instanceof Error?e.message:"Error de sesión");}}).catch(()=>{});
  const id=setInterval(()=>{if(active&&signed&&!busy)void refresh().catch(e=>setError(e instanceof Error?e.message:"Sin conexión"));},5000);
  return ()=>{active=false;clearInterval(id)};
 },[refresh,signed,busy]);
 async function doLogin(){
  if(busy)return;
  if(slot===null){setError("Selecciona tu RIDER 01–05.");return;}
  if(!email.trim()){setError("Indica tu correo autorizado para el primer acceso.");return;}
  setBusy(true);setError("");
  try{
   await loginRider(email.trim(),password);
   const state=await loadConnected();
   if(riderSlotFromName(state.rider.display_name)!==slot){
    await logoutRider();
    throw new Error("La cuenta no corresponde a RIDER "+String(slot).padStart(2,"0")+". Contacta al gerente.");
   }
   // Device caching is optional: authentication must succeed even if SecureStore is unavailable.
   try{await saveRiderEmail(slot,email.trim());setRemembered(true);}catch{setRemembered(false);}
   setPassword("");setData(state);setSigned(true);
  }catch(e){await logoutRider();setPassword("");setError(e instanceof Error?e.message:"Acceso denegado");}
  finally{setBusy(false)}
 }
 async function operate(fn:()=>Promise<void>){if(busy)return;setBusy(true);try{await fn();await refresh();}catch(e){Alert.alert("Operación no realizada",e instanceof Error?e.message:"Error");}finally{setBusy(false)}}
 async function logout(){await logoutRider();setSigned(false);setData(null);setPassword("");}
 const orders=suggestRoute(data?.orders.filter(o=>!["entregado","cancelado"].includes(o.status))||[]);
 const links=orders.length>=2?routeLinks(orders):[];
 return <SafeAreaView style={s.safe}>
 <View style={s.top}><Pressable onPress={()=>router.replace("/")}><Text style={s.back}>‹ Inicio</Text></Pressable><View><Text style={s.brand}>ESTAMBUL DELIVERY</Text><Text style={s.topSub}>RIDER · CONECTADO</Text></View></View>
 <ScrollView contentContainerStyle={s.body}>
 {!isConnectedConfigured?<View style={s.card}><Text style={s.title}>Pendiente de configurar</Text><Text style={s.help}>Debes configurar EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY para activar las cuentas y pedidos compartidos.</Text></View>

 :!signed?<View>
  <View style={s.loginIntro}><Text style={s.loginIntroEyebrow}>ESTAMBUL RIDER PRO</Text><Text style={s.loginIntroTitle}>Tu reparto.{"\n"}Tu ritmo.</Text><Text style={s.loginIntroDetail}>Acceso personal, entregas al día y una experiencia más rápida.</Text></View>
  <View style={[s.card,s.loginCard]}>
   <Text style={s.eyebrow}>01 · IDENTIFÍCATE</Text><Text style={s.title}>¿Qué Rider eres?</Text>
   <View style={s.profileGrid}>{RIDER_SLOTS.map(n=><Pressable key={n} disabled={busy} accessibilityRole="button" accessibilityLabel={"Elegir Rider "+n} accessibilityState={{selected:slot===n}}
    onPress={()=>void chooseSlot(n)} style={[s.profileChip,slot===n&&s.profileChipSelected]}>
    <Text style={[s.profileNumber,slot===n&&s.profileNumberSelected]}>{String(n).padStart(2,"0")}</Text>
    <Text style={[s.profileTitle,slot===n&&s.profileTitleSelected]}>RIDER {String(n).padStart(2,"0")}</Text>
   </Pressable>)}</View>
   <Text style={s.eyebrow}>02 · ACCESO SEGURO</Text>
   {slot===null?<Text style={s.help}>Selecciona tu perfil. Solo entran las cuentas autorizadas.</Text>:<>
    <Text style={s.profileSelectedLine}>● RIDER {String(slot).padStart(2,"0")} seleccionado</Text>
    {!remembered?<><Text style={s.inputLabel}>CORREO AUTORIZADO · PRIMER ACCESO</Text>
     <TextInput style={s.input} autoCapitalize="none" keyboardType="email-address" autoComplete="username" value={email} onChangeText={setEmail} placeholder="Correo de tu cuenta Rider"/></>:null}
    <Text style={s.inputLabel}>CONTRASEÑA INDIVIDUAL</Text>
    <TextInput style={s.input} secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} placeholder="Tu contraseña"/>
    {remembered?<Pressable onPress={()=>void forgetSlot()}><Text style={s.forgetLink}>Usar otro correo en este perfil</Text></Pressable>:null}
    <Pressable disabled={busy||!password} style={[s.button,s.loginButton]} onPress={()=>void doLogin()}><Text style={s.buttonText}>{busy?"Comprobando…":"Entrar a mi turno →"}</Text></Pressable>
    <Text style={s.loginSecurity}>La cuenta debe corresponder a RIDER {String(slot).padStart(2,"0")}. El dispositivo recuerda solo tu correo, nunca la contraseña.</Text>
   </>}
  </View>
 </View>
 :<><View style={s.card}><Text style={s.eyebrow}>MI CUENTA</Text><Text style={s.title}>{data?.rider.display_name||"Cargando..."}</Text><Text style={s.help}>{orders.length} entregas pendientes · sincronización cada 5 s</Text>
 <View style={s.inline}><Pressable style={[s.button,{flex:1,backgroundColor:data?.rider.online?palette.green:palette.dark}]} disabled={busy||!data} onPress={()=>data&&void operate(()=>setRiderOnline(data.rider.id,!data.rider.online))}><Text style={s.buttonText}>{data?.rider.online?"● Disponible · Desconectar":"○ Conectarme"}</Text></Pressable><Pressable style={s.outline} onPress={()=>void logout()}><Text style={s.outlineText}>Salir</Text></Pressable></View></View>
 {links.length>0?<View style={s.card}>
  <Text style={s.eyebrow}>RUTA RECOMENDADA · {orders.length} PEDIDOS</Text>
  <Text style={s.help}>Primero los pedidos más antiguos, con ajuste por cercanía cuando hay coordenadas. No cambia las asignaciones de Last.app ni considera el tráfico.</Text>
  {links.map((link,i)=><Pressable key={link} style={s.outline} onPress={()=>void Linking.openURL(link)}>
    <Text style={s.outlineText}>🗺️ Google Maps · Tramo {i+1} de {links.length}</Text>
  </Pressable>)}
 </View>:null}
 {orders.length===0?<View style={s.card}><Text style={s.help}>Sin pedidos asignados desde Last.app. Asigna manualmente el Rider en LastPOS para que aparezcan aquí.</Text></View>:orders.map(o=><OrderItem key={o.id} order={o} busy={busy} onAdvance={status=>void operate(async()=>{
  await advanceDelivery(o,status);
  if(status==="en_ruta"){
    const target=String(o.destination||"").trim();
    const destination=o.lat!=null&&o.lng!=null?o.lat+","+o.lng:(/burgos|españa|spain/i.test(target)?target:target+", Burgos, España");
    if(destination){
      try{await Linking.openURL("https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(destination)+"&travelmode=driving");}
      catch{Alert.alert("Google Maps","No se pudo abrir automáticamente. Pulsa Google Maps para reintentar.");}
    }
  }
})}/>)}
 </>}
 {!!error&&<Text style={s.error}>{error}</Text>}
 <Text style={s.footer}>Pedidos de Last.app visibles solo tras activar la integración y asignar cada Rider en LastPOS. La ruta es orientativa.</Text>
 </ScrollView></SafeAreaView>
}
function OrderItem({order,busy,onAdvance}:{order:RiderOrder;busy:boolean;onAdvance:(status:DeliveryStatus)=>void}){
 const [checked,setChecked]=useState<Record<number,boolean>>({});
 const [manual,setManual]=useState(false);
 useEffect(()=>{setChecked({});setManual(false);},[order.id,order.items_snapshot?.revision]);
 const list=Array.isArray(order.items_snapshot?.items)?order.items_snapshot.items.slice(0,80):[];
 const hasItems=connectedItemFeature&&list.length>0;
 const ready=hasItems?list.every((_,i)=>checked[i]):manual;
 const checkAndAdvance=(nextStatus:DeliveryStatus)=>{
  if(connectedItemFeature&&nextStatus==="en_ruta"&&!ready){
   Alert.alert("Revisión antes de salir",hasItems?
    "Comprueba cada pizza, bebida y complemento antes de salir.":
    "Confirma que has revisado el ticket y las bolsas con cocina.");
   return;
  }
  onAdvance(nextStatus);
 };
 const status=next[order.status];
 const nav=()=>{
  const text=String(order.destination||"").trim();
  const destination=order.lat!=null&&order.lng!=null
    ?order.lat+","+order.lng
    :(/burgos|españa|spain/i.test(text)?text:text+", Burgos, España");
  if(!destination){Alert.alert("Destino","Sin dirección registrada");return;}
  void Linking.openURL("https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(destination)+"&travelmode=driving");
 };
 const call=()=>{const phone=String(order.customer_phone||"").replace(/[^+0-9]/g,"");if(phone.length>=6)void Linking.openURL("tel:"+phone)};
 return <View style={[s.card,s.orderCard]}><Text style={s.eyebrow}>{order.channel.toUpperCase()} · {order.reference}</Text>
 <Text style={{fontSize:12,fontWeight:"900",color:waiting(order)>=30?"#ad2e21":waiting(order)>=15?"#986515":palette.green,marginBottom:8}}>◷ {waiting(order)} min esperando{waiting(order)>=30?" · PRIORITARIO":""}</Text>
 <Text style={s.title}>{order.customer_name}</Text>
 <Text style={s.eyebrow}>DIRECCIÓN DE ENTREGA</Text>
 <Text style={s.help}>{order.destination}</Text>
 <Text style={s.help}>{order.customer_phone?"☎ "+order.customer_phone:"Sin teléfono de cliente registrado"}</Text>
 {order.notes?<View style={{backgroundColor:"#fff6e8",padding:12,borderRadius:9,marginBottom:12}}><Text style={s.help}>📝 {order.notes}</Text></View>:null}
 {connectedItemFeature&&["asignado","recogido","en_ruta"].includes(order.status)?
  <View style={{backgroundColor:"#f0f7fc",padding:14,borderColor:"#cbdce8",borderWidth:1,borderRadius:14,marginBottom:14}}>
   <Text style={{fontSize:12,fontWeight:"900",color:"#173c58",marginBottom:10}}>🍕 ARTÍCULOS DEL PEDIDO</Text>
   {hasItems?<>
    {list.map((line,i)=><Pressable key={i} accessibilityRole="checkbox" accessibilityState={{checked:Boolean(checked[i]),disabled:order.status==="en_ruta"}}
      disabled={order.status==="en_ruta"} onPress={()=>setChecked(old=>({...old,[i]:!old[i]}))}
      style={{backgroundColor:checked[i]?"#e4f6ed":"#fff",borderColor:checked[i]?"#a1d7ba":"#dce7f1",borderWidth:1,borderRadius:11,padding:12,marginBottom:8,flexDirection:"row",gap:12}}>
      <Text style={{fontSize:22,color:checked[i]?"#14856a":"#6e8195"}}>{checked[i]?"☑":"□"}</Text>
      <View style={{flex:1}}>
       <Text style={{fontSize:14,fontWeight:"800",color:"#162e45"}}>{line.quantity}× {line.name}</Text>
       {!!line.comments&&<Text style={{fontSize:12,color:"#5b738a"}}>📝 {line.comments}</Text>}
       {(line.modifiers||[]).map((m,j)=><Text key={"m"+j} style={{fontSize:12,color:"#527087"}}>+ {m.quantity||1}× {m.name}</Text>)}
       {(line.children||[]).map((child,j)=><Text key={"c"+j} style={{fontSize:12,color:"#527087"}}>↳ {child.quantity||1}× {child.name}</Text>)}
      </View>
     </Pressable>)}
    <Text style={{fontSize:12,fontWeight:"800",color:"#137a61"}}>{list.filter((_,i)=>checked[i]).length} de {list.length} comprobados</Text>
   </>:<>
    <Text style={{fontSize:12,fontWeight:"700",color:"#98631d",marginBottom:11}}>⚠ No hay desglose fiable. Comprueba ticket y bolsas con cocina.</Text>
    <Pressable disabled={order.status==="en_ruta"} accessibilityRole="checkbox" accessibilityState={{checked:manual}}
      onPress={()=>setManual(v=>!v)} style={{flexDirection:"row",gap:10,alignItems:"center",backgroundColor:"#fff",padding:12,borderRadius:10}}>
     <Text style={{fontSize:22,color:"#14856a"}}>{manual?"☑":"□"}</Text>
     <Text style={{fontSize:12,fontWeight:"750",color:"#173c58",flex:1}}>He revisado ticket y bolsas con cocina</Text>
    </Pressable>
   </>}
  </View>:null}
 <View style={{backgroundColor:order.payment_method==="efectivo"?"#fff3d8":order.payment_method==="tarjeta"?"#e9f3ff":"#f2f3f6",padding:13,borderRadius:10,marginBottom:12}}>
 <Text style={{color:palette.dark,fontWeight:"900"}}>{order.payment_method==="efectivo"?"💶 COBRAR EN EFECTIVO":order.payment_method==="tarjeta"?"💳 PAGO CON TARJETA":"PAGO SIN INDICAR"}</Text>
 <Text style={{color:palette.dark,fontSize:20,fontWeight:"900",marginTop:4}}>{new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(order.amount||0)}</Text>
 </View>
 <Text style={s.status}>{order.status.toUpperCase()}</Text>
 <View style={s.inline}><Pressable style={s.outline} onPress={nav}><Text style={s.outlineText}>📍 Google Maps ↗</Text></Pressable>{order.customer_phone?<Pressable style={s.outline} onPress={call}><Text style={s.outlineText}>☎ Llamar</Text></Pressable>:null}{status?<Pressable disabled={busy} style={[s.button,{flex:1}]} onPress={()=>checkAndAdvance(status)}><Text style={s.buttonText}>{nextLabel[status]}</Text></Pressable>:null}</View>
 </View>
}
const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:palette.bg},top:{backgroundColor:palette.dark,padding:20,paddingTop:27,flexDirection:"row",alignItems:"center",gap:20},
 back:{color:"#bdcde0",fontSize:15},brand:{color:"#fff",fontSize:18,fontWeight:"900",letterSpacing:.6},topSub:{color:"#bdcde0",fontSize:10,letterSpacing:1,marginTop:4},
 body:{padding:16,paddingBottom:65},card:{backgroundColor:"#fff",borderColor:"#dce6ef",borderWidth:1,borderRadius:19,padding:20,marginBottom:14,shadowColor:"#183353",shadowOpacity:.07,shadowRadius:13,shadowOffset:{width:0,height:5},elevation:2},
 eyebrow:{fontSize:10,color:"#5c7d98",fontWeight:"900",letterSpacing:.6,marginBottom:8},title:{fontSize:22,fontWeight:"900",color:palette.dark,marginBottom:9},
 help:{color:palette.muted,fontSize:13,lineHeight:21,marginBottom:15},
 input:{backgroundColor:"#f9fbfd",padding:15,borderRadius:12,borderColor:"#cfdeeb",borderWidth:1,marginVertical:8,fontSize:16,minHeight:50},
 button:{backgroundColor:palette.orange,padding:15,borderRadius:12,alignItems:"center",justifyContent:"center"},
 buttonText:{color:"#fff",fontWeight:"900",fontSize:12,textAlign:"center"},inline:{flexDirection:"row",gap:8,marginTop:9,alignItems:"stretch"},
 outline:{padding:13,borderRadius:12,borderWidth:1,borderColor:"#bed1e1",alignItems:"center",justifyContent:"center"},
 outlineText:{color:"#3474a9",fontSize:12,fontWeight:"800"},status:{color:palette.green,fontSize:10,fontWeight:"900",marginBottom:9},
 orderCard:{borderLeftWidth:4,borderLeftColor:"#ee9a46"},
 loginIntro:{backgroundColor:"#112840",borderRadius:23,padding:27,marginBottom:16},
 loginIntroEyebrow:{color:"#f9ba77",fontWeight:"900",fontSize:10,letterSpacing:1.5,marginBottom:8},
 loginIntroTitle:{color:"#fff",fontSize:34,fontWeight:"900",letterSpacing:-1.4,lineHeight:39,marginBottom:8},
 loginIntroDetail:{color:"#cadceb",fontSize:13,lineHeight:21},
 loginCard:{borderRadius:22,padding:23},
 profileGrid:{flexDirection:"row",flexWrap:"wrap",gap:9,marginBottom:25},
 profileChip:{width:"30%",minHeight:94,alignItems:"center",justifyContent:"center",backgroundColor:"#f5f8fc",borderColor:"#dce6ef",borderWidth:1.5,borderRadius:15,padding:8},
 profileChipSelected:{borderColor:"#139b78",backgroundColor:"#eaf9f3"},
 profileNumber:{fontSize:24,fontWeight:"900",color:"#204866",marginBottom:5},
 profileNumberSelected:{color:"#137d61"},
 profileTitle:{fontSize:10,fontWeight:"900",color:"#54748d"},
 profileTitleSelected:{color:"#137d61"},
 profileSelectedLine:{color:"#168567",fontWeight:"800",fontSize:12,marginBottom:12},
 inputLabel:{fontSize:11,color:"#5c748a",fontWeight:"900",letterSpacing:.5},
 forgetLink:{color:"#32699b",fontSize:12,textDecorationLine:"underline",marginVertical:9},
 loginButton:{marginTop:10,minHeight:52,borderRadius:12},
 loginSecurity:{fontSize:11,color:"#748a9f",lineHeight:18,marginTop:13},
 error:{backgroundColor:"#fde7e7",color:"#9b3838",padding:13,borderRadius:9},footer:{textAlign:"center",fontSize:10,color:"#94a3b3",marginTop:17}
})
