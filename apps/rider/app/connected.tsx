import { useCallback,useEffect,useState } from "react";
import { Alert, ActivityIndicator, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import type { DeliveryStatus } from "@estambul/shared";
import { advanceDelivery, isConnectedConfigured, loadConnected, loginRider, registerRider, logoutRider, restoreSession, setRiderOnline, type ConnectedState, type RiderOrder } from "../lib/connected";

const palette={dark:"#15271f",primary:"#1b7452",green:"#147c55",muted:"#697a73",bg:"#f4f6f3",border:"#e0e8e0"};
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
 const [mode,setMode]=useState<"login"|"signup">("login"),[notice,setNotice]=useState("");
 const [signed,setSigned]=useState(false),[data,setData]=useState<ConnectedState|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const refresh=useCallback(async()=>{const d=await loadConnected();setData(d);setSigned(true);setError("");},[]);
 useEffect(()=>{if(!isConnectedConfigured)return;let active=true;
  void restoreSession().then(async ok=>{if(ok&&active)try{await refresh()}catch(e){if(active)setError(e instanceof Error?e.message:"Error de sesión");}}).catch(()=>{});
  const id=setInterval(()=>{if(active&&signed&&!busy)void refresh().catch(e=>setError(e instanceof Error?e.message:"Sin conexión"));},5000);
  return ()=>{active=false;clearInterval(id)};
 },[refresh,signed,busy]);
 async function doLogin(){if(busy)return;setBusy(true);setError("");setNotice("");try{await loginRider(email.trim(),password);setPassword("");await refresh();}catch(e){setError(e instanceof Error?e.message:"Error al entrar");}finally{setBusy(false)}}
 async function doSignup(){if(busy)return;setBusy(true);setError("");setNotice("");try{
  const result=await registerRider(email.trim(),password);setPassword("");
  if(result.sessionCreated){await refresh();}
  else setNotice("Cuenta creada. Confirma el correo y luego vuelve aquí para iniciar sesión. Solo los correos invitados pueden activar una cuenta Rider.");
 }catch(e){setError(e instanceof Error?e.message:"No se pudo crear la cuenta");}finally{setBusy(false)}}
 async function operate(fn:()=>Promise<void>){if(busy)return;setBusy(true);try{await fn();await refresh();}catch(e){Alert.alert("Operación no realizada",e instanceof Error?e.message:"Error");}finally{setBusy(false)}}
 async function logout(){await logoutRider();setSigned(false);setData(null);setPassword("");}
 const orders=suggestRoute(data?.orders.filter(o=>!["entregado","cancelado"].includes(o.status))||[]);
 const links=orders.length>=2?routeLinks(orders):[];
 return <SafeAreaView style={s.safe}>
 <View style={s.top}><Pressable onPress={()=>router.replace("/demo")}><Text style={s.back}>‹ Demo</Text></Pressable><View><Text style={s.brand}>ESTAMBUL DELIVERY</Text><Text style={s.topSub}>RIDER · CONECTADO</Text></View></View>
 <ScrollView contentContainerStyle={s.body}>
 {!isConnectedConfigured?<View style={s.card}><Text style={s.title}>Pendiente de configurar</Text><Text style={s.help}>Debes configurar EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY para activar las cuentas y pedidos compartidos.</Text></View>
 :!signed?<View style={s.card}><Text style={s.title}>{mode==="login"?"Iniciar sesión":"Crear cuenta Rider"}</Text><Text style={s.help}>{mode==="login"?"Usa el correo invitado y confirmado para tu cuenta Rider.":"Regístrate con el correo invitado. Supabase puede pedirte confirmar el correo antes del primer acceso."}</Text>
 <TextInput style={s.input} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" value={email} onChangeText={setEmail} placeholder="Correo del rider"/>
 <TextInput style={s.input} secureTextEntry autoComplete={mode==="login"?"password":"new-password"} textContentType={mode==="login"?"password":"newPassword"} value={password} onChangeText={setPassword} placeholder={mode==="login"?"Contraseña":"Nueva contraseña (mínimo 10 caracteres)"}/>
 {notice?<Text style={s.notice}>{notice}</Text>:null}
 <Pressable disabled={busy} style={s.button} onPress={()=>void(mode==="login"?doLogin():doSignup())}><Text style={s.buttonText}>{busy?(mode==="login"?"Entrando...":"Creando..."):mode==="login"?"Entrar":"Crear cuenta"}</Text></Pressable>
 <Pressable disabled={busy} onPress={()=>{setMode(mode==="login"?"signup":"login");setError("");setNotice("");}} style={{padding:12,alignItems:"center"}}><Text style={s.linkText}>{mode==="login"?"¿Primera vez? Crear cuenta Rider":"Ya tengo cuenta · Iniciar sesión"}</Text></Pressable></View>
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
 return <View style={s.card}><Text style={s.eyebrow}>{order.channel.toUpperCase()} · {order.reference}</Text>
 <Text style={{fontSize:12,fontWeight:"900",color:waiting(order)>=30?"#ad2e21":waiting(order)>=15?"#986515":palette.green,marginBottom:8}}>◷ {waiting(order)} min esperando{waiting(order)>=30?" · PRIORITARIO":""}</Text>
 <Text style={s.title}>{order.customer_name}</Text>
 <Text style={s.eyebrow}>DIRECCIÓN DE ENTREGA</Text>
 <Text style={s.help}>{order.destination}</Text>
 <Text style={s.help}>{order.customer_phone?"☎ "+order.customer_phone:"Sin teléfono de cliente registrado"}</Text>
 {order.notes?<View style={{backgroundColor:"#fff6e8",padding:12,borderRadius:9,marginBottom:12}}><Text style={s.help}>📝 {order.notes}</Text></View>:null}
 <View style={{backgroundColor:order.payment_method==="efectivo"?"#fff3d8":order.payment_method==="tarjeta"?"#e9f3ff":"#f2f3f6",padding:13,borderRadius:10,marginBottom:12}}>
 <Text style={{color:palette.dark,fontWeight:"900"}}>{order.payment_method==="efectivo"?"💶 COBRAR EN EFECTIVO":order.payment_method==="tarjeta"?"💳 PAGO CON TARJETA":"PAGO SIN INDICAR"}</Text>
 <Text style={{color:palette.dark,fontSize:20,fontWeight:"900",marginTop:4}}>{new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(order.amount||0)}</Text>
 </View>
 <Text style={s.status}>{order.status.toUpperCase()}</Text>
 <View style={s.inline}><Pressable style={s.outline} onPress={nav}><Text style={s.outlineText}>📍 Google Maps ↗</Text></Pressable>{order.customer_phone?<Pressable style={s.outline} onPress={call}><Text style={s.outlineText}>☎ Llamar</Text></Pressable>:null}{status?<Pressable disabled={busy} style={[s.button,{flex:1}]} onPress={()=>onAdvance(status)}><Text style={s.buttonText}>{nextLabel[status]}</Text></Pressable>:null}</View>
 </View>
}
const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:palette.bg},top:{backgroundColor:palette.dark,padding:18,paddingTop:24,flexDirection:"row",alignItems:"center",gap:20},
 back:{color:"#c4dc9a",fontSize:15},brand:{color:"#fff",fontSize:18,fontWeight:"900",letterSpacing:.6},topSub:{color:"#c4dc9a",fontSize:10,letterSpacing:1,marginTop:4},
 body:{padding:16,paddingBottom:50},card:{backgroundColor:"#fff",borderColor:palette.border,borderWidth:1,borderRadius:15,padding:19,marginBottom:12},
 eyebrow:{fontSize:10,color:"#697a73",fontWeight:"800",marginBottom:8},title:{fontSize:22,fontWeight:"900",color:palette.dark,marginBottom:9},
 help:{color:palette.muted,fontSize:13,lineHeight:21,marginBottom:15},
 input:{backgroundColor:"#fff",padding:14,borderRadius:9,borderColor:palette.border,borderWidth:1,marginVertical:7},
 button:{backgroundColor:palette.primary,padding:13,borderRadius:9,alignItems:"center",justifyContent:"center"},
 buttonText:{color:"#fff",fontWeight:"900",fontSize:12,textAlign:"center"},inline:{flexDirection:"row",gap:8,marginTop:9,alignItems:"stretch"},
 outline:{padding:12,borderRadius:9,borderWidth:1,borderColor:"#b8cabb",alignItems:"center",justifyContent:"center"},
 outlineText:{color:palette.green,fontSize:12,fontWeight:"800"},status:{color:palette.green,fontSize:10,fontWeight:"900",marginBottom:9},
 notice:{backgroundColor:"#eaf1eb",color:"#1b7452",padding:13,borderRadius:9,marginBottom:10,fontSize:12,lineHeight:18},linkText:{color:"#1b7452",fontSize:12,fontWeight:"800"},error:{backgroundColor:"#fde7e7",color:"#9b3838",padding:13,borderRadius:9},footer:{textAlign:"center",fontSize:10,color:"#8b9b8e",marginTop:17}
})
