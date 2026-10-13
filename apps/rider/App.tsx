import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import type { DeliveryOrder, DeliveryStatus, DemoState, Rider } from "@estambul/shared";
import { channelLabels, statusLabels } from "@estambul/shared";

const API = (process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000").replace(/\/$/, "");
const euro = new Intl.NumberFormat("es-ES", {style:"currency",currency:"EUR"});
const nextStatus: Partial<Record<DeliveryStatus, {status:DeliveryStatus; label:string}>> = {
  asignado: {status:"recogido",label:"✓ Pedido recogido"},
  recogido: {status:"en_ruta",label:"🛵 Iniciar reparto"},
  en_ruta: {status:"entregado",label:"✓ Confirmar entrega"}
};
async function getDemo(): Promise<DemoState> {
  const res = await fetch(API+"/api/demo");
  if(!res.ok) throw new Error("No se pudo conectar con el back office.");
  return await res.json() as DemoState;
}
async function sendStatus(orderId:string,status:DeliveryStatus){
  const res = await fetch(API+"/api/demo",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"status",orderId,status})});
  const body=await res.json();if(!res.ok)throw new Error(body.error||"Error al actualizar pedido");
}
export default function App() {
  const [data,setData]=useState<DemoState|null>(null);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const [sending,setSending]=useState(false);
  const [error,setError]=useState("");
  const [showCompleted,setShowCompleted]=useState(false);
  const refresh=useCallback(async()=>{
    try{const newData=await getDemo();setData(newData);setError("");}
    catch(e){setError(e instanceof Error?e.message:"Error de red");}
  },[]);
  useEffect(()=>{void refresh();const interval=setInterval(()=>void refresh(),5000);return ()=>clearInterval(interval)},[refresh]);
  const rider=data?.riders.find(r=>r.id===selectedId&&r.active);
  const orders=useMemo(()=>data?.orders.filter(o=>o.riderId===selectedId&&(showCompleted||o.status!=="entregado"))??[],[data,selectedId,showCompleted]);
  const outstanding=data?.orders.filter(o=>o.riderId===selectedId&&o.status!=="entregado").length??0;
  const update=async(o:DeliveryOrder,status:DeliveryStatus)=>{
    setSending(true);
    try{await sendStatus(o.id,status);await refresh();}
    catch(e){Alert.alert("No se pudo actualizar",e instanceof Error?e.message:"Error");}
    finally{setSending(false);}
  };
  const openMaps=(o:DeliveryOrder)=>Linking.openURL("https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(o.lat+","+o.lng));
  return <SafeAreaView style={s.safe}>
    <StatusBar barStyle="light-content" backgroundColor="#172c45"/>
    <View style={s.top}>
      <View><Text style={s.topBrand}>ESTAMBUL DELIVERY</Text><Text style={s.topSub}>APP RIDER · DEMOSTRACIÓN</Text></View>
      <View style={s.demoBadge}><Text style={s.demoBadgeText}>DEMO</Text></View>
    </View>
    {!rider ? <ScrollView contentContainerStyle={s.screen}>
      <Text style={s.title}>Elige un repartidor</Text><Text style={s.description}>Simulación de acceso individual. Aquí todavía NO existe autenticación real: para producción será obligatorio iniciar sesión de forma segura.</Text>
      {error?<Text style={s.error}>⚠️ {error} Revisa EXPO_PUBLIC_API_URL y la red.</Text>:null}
      {!data&&!error?<ActivityIndicator color="#ec8935" style={{marginTop:35}}/>:null}
      {data?.riders.filter(r=>r.active).map(r=><Pressable key={r.id} onPress={()=>setSelectedId(r.id)} style={s.riderCard}>
        <View style={s.avatar}><Text style={s.avatarText}>{r.name.split(" ").map(x=>x[0]).join("").slice(0,2)}</Text></View>
        <View style={{flex:1}}><Text style={s.name}>{r.name}</Text><Text style={s.small}>{r.online?"● Conectado":"○ Desconectado"} · {data.orders.filter(o=>o.riderId===r.id&&o.status!=="entregado").length} pedidos</Text></View>
        <Text style={s.arrow}>›</Text>
      </Pressable>)}
      <Pressable style={s.secondaryBtn} onPress={()=>void refresh()}><Text style={s.secondaryText}>↻ Recargar riders</Text></Pressable>
    </ScrollView> : <ScrollView contentContainerStyle={s.screen} refreshControl={<RefreshControl refreshing={loading} onRefresh={async()=>{setLoading(true);await refresh();setLoading(false)}}/>}>
      <View style={s.riderHead}><View><Text style={s.welcome}>Hola, {rider.name} 👋</Text><Text style={s.description}>Pedidos asignados a tu cuenta de prueba</Text></View><Pressable onPress={()=>setSelectedId(null)}><Text style={s.change}>Cambiar</Text></Pressable></View>
      <View style={s.summary}><View><Text style={s.metric}>{outstanding}</Text><Text style={s.metricSub}>Por entregar</Text></View><View style={s.sep}/><View><Text style={s.metric}>{data?.orders.filter(o=>o.riderId===selectedId&&o.status==="entregado").length??0}</Text><Text style={s.metricSub}>Entregados</Text></View><View style={s.sep}/><View><Text style={s.metric}>{rider.online?"ONLINE":"OFF"}</Text><Text style={s.metricSub}>Estado demo</Text></View></View>
      {error?<Text style={s.error}>⚠️ {error}</Text>:null}
      <View style={s.sectionHead}><Text style={s.sectionTitle}>Mis pedidos</Text><Pressable onPress={()=>setShowCompleted(!showCompleted)}><Text style={s.change}>{showCompleted?"Ocultar entregados":"Ver entregados"}</Text></Pressable></View>
      {orders.length===0?<View style={s.empty}><Text style={{fontSize:38}}>🛵</Text><Text style={s.emptyTitle}>Sin pedidos pendientes</Text><Text style={s.description}>Al asignarte un pedido en el back office demo, aparecerá aquí cuando se actualice la lista.</Text></View>:null}
      {orders.map(o=>{const next=nextStatus[o.status];return <View style={s.orderCard} key={o.id}>
        <View style={s.orderTop}><Text style={s.orderId}>{o.id}</Text><Text style={s.source}>{channelLabels[o.channel]}</Text></View>
        <Text style={s.client}>{o.customer}</Text><Text style={s.addr}>📍 {o.address}</Text><Text style={s.note}>{o.notes}</Text>
        <View style={s.infoRow}><Text style={s.amount}>{euro.format(o.amount)}</Text><Text style={s.status}>{statusLabels[o.status]}</Text></View>
        <View style={s.actions}><Pressable style={s.mapBtn} onPress={()=>void openMaps(o)}><Text style={s.mapText}>↗ Google Maps</Text></Pressable>
          {next?<Pressable disabled={sending} style={[s.actionBtn,sending&&{opacity:.5}]} onPress={()=>void update(o,next.status)}><Text style={s.actionText}>{sending?"Enviando...":next.label}</Text></Pressable>:<View style={s.finished}><Text style={s.finishedText}>✓ Entregado</Text></View>}
        </View>
      </View>})}
      <Text style={s.disclaimer}>⚠️ Simulación con datos ficticios. GPS en segundo plano, notificaciones push, login seguro y clientes reales NO están habilitados.</Text>
    </ScrollView>}
  </SafeAreaView>;
}
const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:"#f4f6fa"},top:{backgroundColor:"#172c45",paddingHorizontal:20,paddingVertical:18,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},topBrand:{color:"white",fontWeight:"900",fontSize:16,letterSpacing:1},topSub:{color:"#a5c4da",fontSize:10,marginTop:4,letterSpacing:1},demoBadge:{paddingHorizontal:10,paddingVertical:6,backgroundColor:"#ffb56a",borderRadius:20},demoBadgeText:{color:"#52300a",fontWeight:"900",fontSize:11},screen:{padding:18,paddingBottom:50},title:{fontSize:26,fontWeight:"800",color:"#162a45",marginTop:16},description:{color:"#74869a",fontSize:13,lineHeight:19,marginTop:7},error:{backgroundColor:"#fff1ee",color:"#a34c39",padding:14,marginVertical:14,borderRadius:10,fontSize:12},riderCard:{marginTop:12,backgroundColor:"white",borderWidth:1,borderColor:"#e3e8ef",borderRadius:14,padding:15,flexDirection:"row",alignItems:"center",gap:12},avatar:{backgroundColor:"#e2ecf8",height:46,width:46,alignItems:"center",justifyContent:"center",borderRadius:13},avatarText:{color:"#366797",fontWeight:"800"},name:{fontSize:15,fontWeight:"800",color:"#20384f"},small:{fontSize:11,color:"#8997a5",marginTop:4},arrow:{fontSize:27,color:"#8998a8"},secondaryBtn:{backgroundColor:"white",borderColor:"#dde6ef",borderWidth:1,borderRadius:11,padding:14,alignItems:"center",marginTop:19},secondaryText:{fontSize:13,color:"#2e5d83",fontWeight:"800"},riderHead:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginTop:9},welcome:{fontSize:22,fontWeight:"900",color:"#193048"},change:{color:"#2e7ec3",fontWeight:"800",fontSize:12},summary:{marginTop:21,backgroundColor:"#19334f",borderRadius:16,padding:20,flexDirection:"row",justifyContent:"space-around",alignItems:"center"},metric:{color:"white",fontSize:25,fontWeight:"900",textAlign:"center"},metricSub:{color:"#acc6d9",fontSize:10,marginTop:4,textAlign:"center"},sep:{width:1,height:34,backgroundColor:"#45627e"},sectionHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginTop:24,marginBottom:5},sectionTitle:{fontSize:18,fontWeight:"900",color:"#1d364e"},empty:{backgroundColor:"white",alignItems:"center",padding:30,borderRadius:14,marginTop:17},emptyTitle:{fontSize:16,fontWeight:"800",color:"#1c3953",marginTop:9},orderCard:{backgroundColor:"white",borderColor:"#e4e8ee",borderWidth:1,borderRadius:15,padding:17,marginTop:12},orderTop:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},orderId:{color:"#203e5b",fontSize:13,fontWeight:"900"},source:{backgroundColor:"#eef4fa",padding:6,borderRadius:5,color:"#3c6c96",fontSize:10,fontWeight:"800"},client:{color:"#203d59",fontSize:18,fontWeight:"900",marginTop:15},addr:{color:"#506981",fontSize:13,marginTop:8},note:{color:"#8b9cab",fontSize:11,marginTop:6},infoRow:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginVertical:17},amount:{color:"#203a51",fontSize:17,fontWeight:"800"},status:{backgroundColor:"#e9f5ff",paddingVertical:5,paddingHorizontal:9,borderRadius:7,color:"#296ba4",fontSize:11,fontWeight:"800"},actions:{flexDirection:"row",gap:9},mapBtn:{flex:1,borderColor:"#d7e5f1",borderWidth:1,borderRadius:9,alignItems:"center",paddingVertical:13,justifyContent:"center"},mapText:{color:"#2b73ac",fontWeight:"800",fontSize:11},actionBtn:{flex:1.25,backgroundColor:"#eb8b3d",borderRadius:9,alignItems:"center",justifyContent:"center",paddingVertical:13},actionText:{fontSize:11,fontWeight:"900",color:"white"},finished:{flex:1.25,backgroundColor:"#e5f7ef",paddingVertical:13,borderRadius:9,alignItems:"center"},finishedText:{color:"#277851",fontWeight:"900",fontSize:11},disclaimer:{fontSize:11,color:"#9aa5b0",lineHeight:17,marginTop:22,textAlign:"center"}
});
