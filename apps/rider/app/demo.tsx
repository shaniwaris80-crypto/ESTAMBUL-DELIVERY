import { useCallback, useEffect, useMemo, useState } from "react";
import { router } from "expo-router";
import { ActivityIndicator, Alert, FlatList, Linking, Pressable, RefreshControl, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { channelLabels, statusLabels, type DeliveryOrder, type DeliveryStatus, type DemoState } from "@estambul/shared";
import { isRemoteDemo, loadDemo, openDirections, updateDemoStatus } from "../lib/demo";

const colors={navy:"#14253b",white:"#fff",muted:"#7c8b9b",light:"#f3f6fa",blue:"#2563eb",orange:"#ed8b39",border:"#e3e9f0",green:"#139b78"};
const statusActions:Record<DeliveryStatus,{label:string,next:DeliveryStatus}|null>={
  pendiente:null,
  asignado:{label:"Confirmar recogida",next:"recogido"},
  recogido:{label:"Iniciar reparto",next:"en_ruta"},
  en_ruta:{label:"Confirmar entrega",next:"entregado"},
  entregado:null
};
export default function RiderHome(){
  const [data,setData]=useState<DemoState|null>(null);
  const [riderId,setRiderId]=useState("r-a");
  const [error,setError]=useState("");
  const [refreshing,setRefreshing]=useState(false);
  const [busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>{try{const d=await loadDemo();setData(d);setError("");}catch(e){setError(e instanceof Error?e.message:"No se pudo conectar");}},[]);
  useEffect(()=>{void refresh();if(!isRemoteDemo)return;const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer);},[refresh]);
  const rider=data?.riders.find(r=>r.id===riderId&&r.active);
  const orders=useMemo(()=>data?.orders.filter(o=>o.riderId===riderId&&o.status!=="entregado")??[],[data,riderId]);
  const delivered=data?.orders.filter(o=>o.riderId===riderId&&o.status==="entregado").length??0;
  const onRefresh=async()=>{setRefreshing(true);await refresh();setRefreshing(false);};
  const changeStatus=async(order:DeliveryOrder,next:DeliveryStatus)=>{
    setBusy(true);
    try{const updated=await updateDemoStatus(order.id,next);setData(updated);setError("");}
    catch(e){Alert.alert("No se pudo guardar",e instanceof Error?e.message:"Error");}
    finally{setBusy(false);}
  };
  const navigate=async(order:DeliveryOrder)=>{try{await Linking.openURL(openDirections(order));}catch{Alert.alert("Google Maps","No se ha podido abrir la navegación.");}};
  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="light-content"/>
    <View style={styles.top}><View><Text style={styles.brand}>ESTAMBUL DELIVERY</Text><Text style={styles.subtitle}>APP RIDER · DEMOSTRACIÓN</Text></View><View style={styles.topIcon}><Text style={{fontSize:20}}>🚴</Text></View></View>
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh}/>}>
      <View style={styles.warning}><Text style={styles.warningText}>MODO DEMO · Pedidos ficticios · Sin cuenta real ni GPS activo</Text></View>
      <Pressable onPress={()=>router.push("/connected")} style={{backgroundColor:"#203d5a",padding:15,borderRadius:12,marginBottom:18}}><Text style={{color:"#fff",fontWeight:"900",textAlign:"center"}}>🔒 Abrir modo conectado con mi cuenta →</Text></Pressable>
      <Text style={styles.sectionLabel}>SELECCIONAR RIDER DE PRUEBA</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.riderSelector}>
        {data?.riders.filter(r=>r.active).map(r=><Pressable key={r.id} onPress={()=>setRiderId(r.id)} style={[styles.riderOption,r.id===riderId&&styles.riderSelected]}>
          <Text style={[styles.riderName,r.id===riderId&&styles.riderNameSelected]}>{r.name}</Text><Text style={[styles.riderSmall,r.id===riderId&&styles.riderSmallSelected]}>{r.online?"● Conectado":"○ Offline"}</Text>
        </Pressable>)}
      </ScrollView>
      {rider?<View style={styles.welcome}><View><Text style={styles.welcomeSmall}>Hola, {rider.name}</Text><Text style={styles.welcomeTitle}>Tus entregas</Text></View><View style={styles.count}><Text style={styles.countText}>{orders.length}</Text></View></View>:<Text style={styles.error}>Rider no disponible en la demo. Selecciona otro.</Text>}
      <View style={styles.counters}><View style={styles.counter}><Text style={styles.counterNumber}>{orders.length}</Text><Text style={styles.counterLabel}>Pendientes</Text></View><View style={styles.counter}><Text style={styles.counterNumber}>{orders.filter(o=>o.status==="en_ruta").length}</Text><Text style={styles.counterLabel}>En ruta</Text></View><View style={styles.counter}><Text style={styles.counterNumber}>{delivered}</Text><Text style={styles.counterLabel}>Entregados</Text></View></View>
      <View style={styles.titleRow}><Text style={styles.title}>Pedidos asignados</Text><Text style={styles.live}>{isRemoteDemo?"↻ Servidor demo":"◎ Demo local"}</Text></View>
      {error?<Text style={styles.error}>{error}</Text>:null}
      {!data?<ActivityIndicator color={colors.orange} style={{padding:30}}/>:orders.length===0?<View style={styles.empty}><Text style={styles.emptyEmoji}>📦</Text><Text style={styles.emptyTitle}>Sin entregas pendientes</Text><Text style={styles.emptySubtitle}>Selecciona otro rider o asigna pedidos desde el back office de pruebas.</Text></View>:orders.map(order=><OrderCard key={order.id} order={order} busy={busy} onNavigate={()=>void navigate(order)} onStatus={status=>void changeStatus(order,status)}/>)}
      <Text style={styles.footer}>Sin integración real con Last.app. Para pruebas compartidas, configura EXPO_PUBLIC_DEMO_API_URL y abre el servidor en tu ordenador.</Text>
    </ScrollView>
  </SafeAreaView>;
}
function OrderCard({order,busy,onNavigate,onStatus}:{order:DeliveryOrder;busy:boolean;onNavigate:()=>void;onStatus:(next:DeliveryStatus)=>void}){
  const next=statusActions[order.status];
  return <View style={styles.orderCard}>
    <View style={styles.orderHeader}><View><Text style={styles.orderId}>#{order.id}</Text><Text style={styles.orderChannel}>{channelLabels[order.channel]}</Text></View><Text style={styles.statusChip}>{statusLabels[order.status]}</Text></View>
    <Text style={styles.customer}>{order.customer}</Text><Text style={styles.address}>📍 {order.address}</Text><Text style={styles.amount}>Importe: {order.amount.toFixed(2).replace(".",",")} €</Text>
    <View style={styles.actions}><Pressable onPress={onNavigate} style={styles.mapButton}><Text style={styles.mapButtonText}>↗ Google Maps</Text></Pressable>{next?<Pressable disabled={busy} onPress={()=>onStatus(next.next)} style={[styles.statusButton,busy&&{opacity:.5}]}><Text style={styles.statusButtonText}>{next.label}</Text></Pressable>:null}</View>
  </View>;
}
const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.light},
  top:{paddingTop:25,paddingBottom:23,paddingHorizontal:20,backgroundColor:colors.navy,flexDirection:"row",justifyContent:"space-between",alignItems:"center"},
  brand:{color:"white",fontSize:20,fontWeight:"900",letterSpacing:.8},subtitle:{color:"#b5c9da",fontSize:10,marginTop:5,letterSpacing:1},
  topIcon:{backgroundColor:"#294560",width:45,height:45,borderRadius:14,alignItems:"center",justifyContent:"center"},
  content:{padding:17,paddingBottom:48},
  warning:{borderRadius:10,backgroundColor:"#fff1df",padding:12,marginBottom:24},
  warningText:{color:"#a65b18",fontSize:11,fontWeight:"700",textAlign:"center"},
  sectionLabel:{fontSize:10,fontWeight:"800",letterSpacing:1,color:colors.muted,marginBottom:10},
  riderSelector:{gap:9,paddingBottom:18},
  riderOption:{borderRadius:11,borderWidth:1,borderColor:colors.border,backgroundColor:"white",padding:12,minWidth:110},
  riderSelected:{backgroundColor:"#203d5a",borderColor:"#203d5a"},
  riderName:{fontSize:13,color:colors.navy,fontWeight:"800"},riderNameSelected:{color:"white"},
  riderSmall:{fontSize:10,color:colors.muted,marginTop:5},riderSmallSelected:{color:"#d2dfed"},
  welcome:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:13},
  welcomeSmall:{fontSize:13,color:colors.muted},welcomeTitle:{fontSize:24,fontWeight:"900",color:colors.navy,marginTop:4},
  count:{backgroundColor:"#e7eef8",paddingHorizontal:16,paddingVertical:8,borderRadius:11},
  countText:{fontSize:21,color:colors.blue,fontWeight:"900"},
  counters:{flexDirection:"row",gap:9,marginBottom:27},
  counter:{flex:1,backgroundColor:"white",borderRadius:13,padding:13,borderWidth:1,borderColor:colors.border},
  counterNumber:{fontSize:25,fontWeight:"900",color:colors.navy},
  counterLabel:{fontSize:10,color:colors.muted,marginTop:4},
  titleRow:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:13},
  title:{fontSize:16,fontWeight:"800",color:colors.navy},live:{color:colors.green,fontSize:10,fontWeight:"700"},
  orderCard:{backgroundColor:"white",borderRadius:15,borderWidth:1,borderColor:colors.border,padding:17,marginBottom:12},
  orderHeader:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:16},
  orderId:{fontSize:13,fontWeight:"900",color:colors.navy},
  orderChannel:{color:colors.muted,fontSize:10,marginTop:4},
  statusChip:{overflow:"hidden",color:"#237aaa",backgroundColor:"#eaf5ff",padding:8,borderRadius:8,fontSize:10,fontWeight:"800"},
  customer:{color:colors.navy,fontSize:18,fontWeight:"900",marginBottom:8},
  address:{color:"#526b81",fontSize:13,lineHeight:20,marginBottom:7},
  amount:{color:colors.muted,fontSize:12,marginBottom:15},
  actions:{flexDirection:"row",gap:8},
  mapButton:{flex:1,borderWidth:1,borderColor:"#bcd0e8",borderRadius:9,paddingVertical:12,alignItems:"center",justifyContent:"center"},
  mapButtonText:{fontSize:11,fontWeight:"800",color:"#296eae"},
  statusButton:{flex:1,backgroundColor:colors.orange,borderRadius:9,paddingVertical:12,alignItems:"center",justifyContent:"center"},
  statusButtonText:{fontSize:11,fontWeight:"800",color:"white"},
  empty:{alignItems:"center",backgroundColor:"white",padding:32,borderRadius:14},
  emptyEmoji:{fontSize:37},emptyTitle:{fontSize:15,color:colors.navy,fontWeight:"800",marginTop:14},
  emptySubtitle:{fontSize:12,color:colors.muted,textAlign:"center",marginTop:8,lineHeight:19},
  error:{padding:12,backgroundColor:"#fee6e6",borderRadius:10,color:"#a13434",marginBottom:14},
  footer:{fontSize:10,color:colors.muted,lineHeight:17,textAlign:"center",marginTop:18}
});
