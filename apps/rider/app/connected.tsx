import { useCallback,useEffect,useState } from "react";
import { Alert, ActivityIndicator, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import type { DeliveryStatus } from "@estambul/shared";
import { advanceDelivery, isConnectedConfigured, loadConnected, loginRider, logoutRider, restoreSession, setRiderOnline, type ConnectedState, type RiderOrder } from "../lib/connected";

const palette={dark:"#14253b",orange:"#ee9848",green:"#199874",muted:"#7890a4",bg:"#f3f6fa"};
const next:{[key:string]:DeliveryStatus}={asignado:"recogido",recogido:"en_ruta",en_ruta:"entregado"};
const nextLabel:{[key:string]:string}={recogido:"Confirmar recogida",en_ruta:"Iniciar reparto",entregado:"Confirmar entrega"};
export default function Connected(){
 const [email,setEmail]=useState(""),[password,setPassword]=useState("");
 const [signed,setSigned]=useState(false),[data,setData]=useState<ConnectedState|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const refresh=useCallback(async()=>{const d=await loadConnected();setData(d);setSigned(true);setError("");},[]);
 useEffect(()=>{if(!isConnectedConfigured)return;let active=true;
  void restoreSession().then(async ok=>{if(ok&&active)try{await refresh()}catch(e){if(active)setError(e instanceof Error?e.message:"Error de sesión");}}).catch(()=>{});
  const id=setInterval(()=>{if(active&&signed&&!busy)void refresh().catch(e=>setError(e instanceof Error?e.message:"Sin conexión"));},5000);
  return ()=>{active=false;clearInterval(id)};
 },[refresh,signed,busy]);
 async function doLogin(){if(busy)return;setBusy(true);try{await loginRider(email.trim(),password);setPassword("");await refresh();}catch(e){setError(e instanceof Error?e.message:"Error al entrar");}finally{setBusy(false)}}
 async function operate(fn:()=>Promise<void>){if(busy)return;setBusy(true);try{await fn();await refresh();}catch(e){Alert.alert("Operación no realizada",e instanceof Error?e.message:"Error");}finally{setBusy(false)}}
 async function logout(){await logoutRider();setSigned(false);setData(null);setPassword("");}
 const orders=data?.orders.filter(o=>!["entregado","cancelado"].includes(o.status))||[];
 return <SafeAreaView style={s.safe}>
 <View style={s.top}><Pressable onPress={()=>router.replace("/")}><Text style={s.back}>‹ Demo</Text></Pressable><View><Text style={s.brand}>ESTAMBUL DELIVERY</Text><Text style={s.topSub}>RIDER · CONECTADO</Text></View></View>
 <ScrollView contentContainerStyle={s.body}>
 {!isConnectedConfigured?<View style={s.card}><Text style={s.title}>Pendiente de configurar</Text><Text style={s.help}>Debes configurar EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY para activar las cuentas y pedidos compartidos.</Text></View>
 :!signed?<View style={s.card}><Text style={s.title}>Iniciar sesión</Text><Text style={s.help}>Usa tu cuenta individual de rider de pruebas.</Text>
 <TextInput style={s.input} autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} placeholder="Correo del rider"/>
 <TextInput style={s.input} secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} placeholder="Contraseña"/>
 <Pressable disabled={busy} style={s.button} onPress={()=>void doLogin()}><Text style={s.buttonText}>{busy?"Entrando...":"Entrar"}</Text></Pressable></View>
 :<><View style={s.card}><Text style={s.eyebrow}>MI CUENTA</Text><Text style={s.title}>{data?.rider.display_name||"Cargando..."}</Text><Text style={s.help}>{orders.length} entregas pendientes · sincronización cada 5 s</Text>
 <View style={s.inline}><Pressable style={[s.button,{flex:1,backgroundColor:data?.rider.online?palette.green:palette.dark}]} disabled={busy||!data} onPress={()=>data&&void operate(()=>setRiderOnline(data.rider.id,!data.rider.online))}><Text style={s.buttonText}>{data?.rider.online?"● Disponible · Desconectar":"○ Conectarme"}</Text></Pressable><Pressable style={s.outline} onPress={()=>void logout()}><Text style={s.outlineText}>Salir</Text></Pressable></View></View>
 {orders.length===0?<View style={s.card}><Text style={s.help}>No hay pedidos asignados. Espera a que el supervisor te asigne uno desde el back office.</Text></View>:orders.map(o=><OrderItem key={o.id} order={o} busy={busy} onAdvance={status=>void operate(()=>advanceDelivery(o,status))}/>)}
 </>}
 {!!error&&<Text style={s.error}>{error}</Text>}
 <Text style={s.footer}>MODO PRUEBAS · Sin pedidos reales de Last.app · Sin seguimiento GPS activo.</Text>
 </ScrollView></SafeAreaView>
}
function OrderItem({order,busy,onAdvance}:{order:RiderOrder;busy:boolean;onAdvance:(status:DeliveryStatus)=>void}){
 const status=next[order.status];
 const nav=()=>{if(order.lat==null||order.lng==null){Alert.alert("Destino","Sin coordenadas");return}void Linking.openURL("https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(order.lat+","+order.lng)+"&travelmode=driving")};
 return <View style={s.card}><Text style={s.eyebrow}>{order.channel.toUpperCase()} · {order.reference}</Text><Text style={s.title}>{order.customer_name}</Text><Text style={s.help}>{order.destination}</Text><Text style={s.status}>{order.status.toUpperCase()}</Text>
 <View style={s.inline}><Pressable style={s.outline} onPress={nav}><Text style={s.outlineText}>Google Maps ↗</Text></Pressable>{status?<Pressable disabled={busy} style={[s.button,{flex:1}]} onPress={()=>onAdvance(status)}><Text style={s.buttonText}>{nextLabel[status]}</Text></Pressable>:null}</View>
 </View>
}
const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:palette.bg},top:{backgroundColor:palette.dark,padding:18,paddingTop:24,flexDirection:"row",alignItems:"center",gap:20},
 back:{color:"#bdcde0",fontSize:15},brand:{color:"#fff",fontSize:18,fontWeight:"900",letterSpacing:.6},topSub:{color:"#bdcde0",fontSize:10,letterSpacing:1,marginTop:4},
 body:{padding:16,paddingBottom:50},card:{backgroundColor:"#fff",borderColor:"#e0e7ee",borderWidth:1,borderRadius:15,padding:19,marginBottom:12},
 eyebrow:{fontSize:10,color:"#7593ab",fontWeight:"800",marginBottom:8},title:{fontSize:22,fontWeight:"900",color:palette.dark,marginBottom:9},
 help:{color:palette.muted,fontSize:13,lineHeight:21,marginBottom:15},
 input:{backgroundColor:"#fff",padding:14,borderRadius:9,borderColor:"#dbe3eb",borderWidth:1,marginVertical:7},
 button:{backgroundColor:palette.orange,padding:13,borderRadius:9,alignItems:"center",justifyContent:"center"},
 buttonText:{color:"#fff",fontWeight:"900",fontSize:12,textAlign:"center"},inline:{flexDirection:"row",gap:8,marginTop:9,alignItems:"stretch"},
 outline:{padding:12,borderRadius:9,borderWidth:1,borderColor:"#b4c9df",alignItems:"center",justifyContent:"center"},
 outlineText:{color:"#3474a9",fontSize:12,fontWeight:"800"},status:{color:palette.green,fontSize:10,fontWeight:"900",marginBottom:9},
 error:{backgroundColor:"#fde7e7",color:"#9b3838",padding:13,borderRadius:9},footer:{textAlign:"center",fontSize:10,color:"#94a3b3",marginTop:17}
})
