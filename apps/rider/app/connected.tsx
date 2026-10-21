import { useCallback,useEffect,useRef,useState } from "react";
import { Alert, ActivityIndicator, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { DeliveryStatus } from "@estambul/shared";
import { advanceDelivery, isConnectedConfigured, connectedItemFeature, connectedPaymentConfirmation, loadConnected, loginRider, logoutRider, restoreSession, setRiderOnline, type DeliveryCollection, type ConnectedState, type RiderOrder } from "../lib/connected";
import {RIDER_SLOTS,savedRiderEmail,saveRiderEmail,clearRiderEmail,riderSlotFromName} from "../lib/rider-profiles";

const palette={dark:"#10243a",orange:"#008b60",green:"#008b60",muted:"#6d8195",bg:"#f2f5fa"};
const next:{[key:string]:DeliveryStatus}={asignado:"recogido",recogido:"en_ruta",en_ruta:"entregado"};
const nextLabel:{[key:string]:string}={recogido:"Confirm pickup",en_ruta:"Start delivery",entregado:"Confirm delivery"};
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
 const [screen,setScreen]=useState<"deliveries"|"wallet"|"account">("deliveries");
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const refresh=useCallback(async()=>{const d=await loadConnected();setData(d);setSigned(true);setError("");},[]);
 useEffect(()=>{if(!isConnectedConfigured)return;let active=true;
  void restoreSession().then(async ok=>{if(ok&&active)try{await refresh()}catch(e){if(active)setError(e instanceof Error?e.message:"Error de sesión");}}).catch(()=>{});
  const id=setInterval(()=>{if(active&&signed&&!busy)void refresh().catch(e=>setError(e instanceof Error?e.message:"Sin conexión"));},5000);
  return ()=>{active=false;clearInterval(id)};
 },[refresh,signed,busy]);
 async function doLogin(){
  if(busy)return;
  if(slot===null){setError("Select your RIDER 01–05.");return;}
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
 const completed=(data?.orders||[]).filter(o=>o.status==="entregado");
 const cashRecorded=completed.filter(o=>o.payment_method==="efectivo").reduce((sum,o)=>sum+Math.max(0,Number(o.amount)||0),0);
 const money=(value:number)=>new Intl.NumberFormat("en-IE",{style:"currency",currency:"EUR"}).format(value);
 return <SafeAreaView style={s.safe}>
 <View style={s.top}><View><Text style={s.brand}>ESTAMBUL <Text style={{color:palette.green}}>DELIVERY</Text></Text><Text style={s.topSub}>RIDER · CONNECTED</Text></View>{signed?<Text style={{color:data?.rider.online?palette.green:palette.muted,fontSize:12,fontWeight:"800"}}>{data?.rider.online?"● Online":"○ Offline"}</Text>:null}</View>
 <ScrollView contentContainerStyle={s.body}>
 {!isConnectedConfigured?<View style={s.card}><Text style={s.title}>Pendiente de configurar</Text><Text style={s.help}>Debes configurar EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY para activar las cuentas y pedidos compartidos.</Text></View>

 :!signed?<View>
  <View style={s.loginIntro}><Text style={s.loginIntroEyebrow}>ESTAMBUL RIDER PRO</Text><Text style={s.loginIntroTitle}>Your deliveries.{"\n"}Your way.</Text><Text style={s.loginIntroDetail}>Acceso personal, entregas al día y una experiencia más rápida.</Text></View>
  <View style={[s.card,s.loginCard]}>
   <Text style={s.eyebrow}>01 · IDENTIFÍCATE</Text><Text style={s.title}>Choose your rider profile</Text>
   <View style={s.profileGrid}>{RIDER_SLOTS.map(n=><Pressable key={n} disabled={busy} accessibilityRole="button" accessibilityLabel={"Elegir Rider "+n} accessibilityState={{selected:slot===n}}
    onPress={()=>void chooseSlot(n)} style={[s.profileChip,slot===n&&s.profileChipSelected]}>
    <Text style={[s.profileNumber,slot===n&&s.profileNumberSelected]}>{String(n).padStart(2,"0")}</Text>
    <Text style={[s.profileTitle,slot===n&&s.profileTitleSelected]}>RIDER {String(n).padStart(2,"0")}</Text>
   </Pressable>)}</View>
   <Text style={s.eyebrow}>02 · ACCESO SEGURO</Text>
   {slot===null?<Text style={s.help}>Select your profile. Only authorized accounts can sign in.</Text>:<>
    <Text style={s.profileSelectedLine}>● RIDER {String(slot).padStart(2,"0")} seleccionado</Text>
    {!remembered?<><Text style={s.inputLabel}>AUTHORIZED EMAIL · FIRST SIGN IN</Text>
     <TextInput style={s.input} autoCapitalize="none" keyboardType="email-address" autoComplete="username" value={email} onChangeText={setEmail} placeholder="Correo de tu cuenta Rider"/></>:null}
    <Text style={s.inputLabel}>YOUR PASSWORD</Text>
    <TextInput style={s.input} secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} placeholder="Tu contraseña"/>
    {remembered?<Pressable onPress={()=>void forgetSlot()}><Text style={s.forgetLink}>Usar otro correo en este perfil</Text></Pressable>:null}
    <Pressable disabled={busy||!password} style={[s.button,s.loginButton]} onPress={()=>void doLogin()}><Text style={s.buttonText}>{busy?"Comprobando…":"Start my shift →"}</Text></Pressable>
    <Text style={s.loginSecurity}>La cuenta debe corresponder a RIDER {String(slot).padStart(2,"0")}. El dispositivo recuerda solo tu correo, nunca la contraseña.</Text>
   </>}
  </View>
 </View>
 :<>{screen==="account"?<><View style={s.card}><Text style={s.eyebrow}>MY ACCOUNT</Text><Text style={s.title}>{data?.rider.display_name||"Loading..."}</Text><Text style={s.help}>{orders.length} assigned deliveries · sync every 5s</Text>
 <View style={s.inline}><Pressable style={[s.button,{flex:1,backgroundColor:data?.rider.online?palette.green:palette.dark}]} disabled={busy||!data} onPress={()=>data&&void operate(()=>setRiderOnline(data.rider.id,!data.rider.online))}><Text style={s.buttonText}>{data?.rider.online?"● Online · Go offline":"○ Go online"}</Text></Pressable><Pressable style={s.outline} onPress={()=>void logout()}><Text style={s.outlineText}>Log out</Text></Pressable></View></View>
 <Text style={s.help}>This profile uses your individual Supabase account. Assignments are managed in LastPOS.</Text></>:null}
 {screen==="wallet"?<><View style={s.card}><Text style={s.eyebrow}>WALLET · READ ONLY</Text>
 <Text style={s.title}>Payment overview</Text>
 <View style={s.inline}><View style={{flex:1}}><Text style={s.eyebrow}>DELIVERED ORDERS</Text><Text style={s.title}>{completed.length}</Text></View>
 <View style={{flex:1}}><Text style={s.eyebrow}>RECORDED CASH</Text><Text style={s.title}>{money(cashRecorded)}</Text></View></View>
 <Text style={s.help}>Amounts are based on delivered orders visible to your account. This is not a finalized cashout. Complete the official reconciliation in Back Office.</Text></View>
 <View style={s.card}><Text style={s.eyebrow}>RECENT DELIVERIES</Text>
 {completed.length===0?<Text style={s.help}>No completed deliveries in the visible period.</Text>:completed.slice(0,20).map(o=>
 <View key={o.id} style={{paddingVertical:12,borderBottomWidth:1,borderBottomColor:"#e4ecef",flexDirection:"row",justifyContent:"space-between"}}>
 <View><Text style={{fontWeight:"800",color:palette.dark}}>#{o.reference}</Text><Text style={{color:palette.muted,fontSize:11}}>{o.payment_method==="efectivo"?"Cash":o.payment_method==="tarjeta"?"Card":"Not classified"}</Text></View>
 <Text style={{fontWeight:"800",color:palette.dark}}>{money(Number(o.amount)||0)}</Text></View>)}</View></>:null}
 {screen==="deliveries"?<>{links.length>0?<View style={s.card}>
  <Text style={s.eyebrow}>SUGGESTED ROUTE · {orders.length} ORDERS</Text>
  <Text style={s.help}>Oldest orders first, with an approximate distance adjustment where coordinates are available. Does not change LastPOS assignments or account for traffic.</Text>
  {links.map((link,i)=><Pressable key={link} style={s.outline} onPress={()=>void Linking.openURL(link)}>
    <Text style={s.outlineText}>🗺️ Google Maps · Segment {i+1} of {links.length}</Text>
  </Pressable>)}
 </View>:null}
 {orders.length===0?<View style={s.card}><Text style={s.help}>No deliveries assigned yet. Assign a Rider manually in LastPOS to see orders here.</Text></View>:orders.map(o=><OrderItem key={o.id} order={o} busy={busy} onAdvance={(status,collection)=>void operate(async()=>{
  await advanceDelivery(o,status,collection);
  if(status==="en_ruta"){
    const target=String(o.destination||"").trim();
    const destination=o.lat!=null&&o.lng!=null?o.lat+","+o.lng:(/burgos|españa|spain/i.test(target)?target:target+", Burgos, España");
    if(destination){
      try{await Linking.openURL("https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(destination)+"&travelmode=driving");}
      catch{Alert.alert("Google Maps","No se pudo abrir automáticamente. Pulsa Google Maps para reintentar.");}
    }
  }
})}/>)}
 </>:null}</>}
 {!!error&&<Text style={s.error}>{error}</Text>}
 <Text style={s.footer}>Last.app orders only appear when riders are assigned manually in LastPOS. Routes are estimates.</Text>
 </ScrollView>
 {signed?<View style={s.tabBar}>
  {(["deliveries","wallet","account"] as const).map(tab=><Pressable key={tab} onPress={()=>setScreen(tab)}
   accessibilityRole="tab" accessibilityState={{selected:screen===tab}}
   style={[s.tab,screen===tab&&s.tabSelected]}>
    <Text style={{fontSize:22,color:screen===tab?palette.green:palette.muted}}>{tab==="deliveries"?"▤":tab==="wallet"?"▣":"♙"}</Text>
    <Text style={{fontSize:11,fontWeight:"800",color:screen===tab?palette.green:palette.muted}}>{tab==="deliveries"?"Deliveries":tab==="wallet"?"Wallet":"Account"}</Text>
   </Pressable>)}
 </View>:null}</SafeAreaView>
}
function optionalPackingCategory(line:{name:string;children?:{name:string}[]}):"pizza"|"bebida"|null{
 const names=[line.name,...(line.children||[]).map(x=>x.name)];
 const norm=names.join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 if(/\b(pizzas?|pizzetas?|calzones?)\b/.test(norm))return "pizza";
 if(/\b(bebidas?|refrescos?|aguas?|coca[\s-]?colas?|colas?|pepsis?|fantas?|sprites?|seven[\s-]?up|7[\s-]?up|aquarius|nesteas?|kas|zumos?|jugos?|cervezas?|tonicas?|red[\s-]?bull|monsters?|batidos?)\b/.test(norm))return "bebida";
 return null;
}
function OrderItem({order,busy,onAdvance}:{order:RiderOrder;busy:boolean;onAdvance:(status:DeliveryStatus,payment?:DeliveryCollection)=>void}){
 const [collection,setCollection]=useState<DeliveryCollection|null>(null);
 useEffect(()=>{setCollection(null);},[order.id,order.status]);
 const [checked,setChecked]=useState<Record<number,boolean>>({});
 useEffect(()=>{setChecked({});},[order.id,order.items_snapshot?.revision]);
 const list=Array.isArray(order.items_snapshot?.items)?order.items_snapshot.items.slice(0,80):[];
 const hasItems=connectedItemFeature&&list.length>0;
 const optionalIndexes=list.map((line,i)=>optionalPackingCategory(line)?i:-1).filter(i=>i>=0);
 const optionalChecked=optionalIndexes.filter(i=>checked[i]).length;
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
 <Text style={{fontSize:12,fontWeight:"900",color:waiting(order)>=30?"#ad2e21":waiting(order)>=15?"#986515":palette.green,marginBottom:8}}>◷ {waiting(order)} min waiting{waiting(order)>=30?" · PRIORITY":""}</Text>
 <Text style={s.title}>{order.customer_name}</Text>
 <Text style={s.eyebrow}>DELIVERY ADDRESS</Text>
 <Text style={s.help}>{order.destination}</Text>
 <Text style={s.help}>{order.customer_phone?"☎ "+order.customer_phone:"No customer phone listed"}</Text>
 {order.notes?<View style={{backgroundColor:"#fff6e8",padding:12,borderRadius:9,marginBottom:12}}><Text style={s.help}>📝 {order.notes}</Text></View>:null}
 {connectedItemFeature&&["asignado","recogido","en_ruta"].includes(order.status)?
  <View style={{backgroundColor:"#f0f7fc",padding:14,borderColor:"#cbdce8",borderWidth:1,borderRadius:14,marginBottom:14}}>
   <Text style={{fontSize:12,fontWeight:"900",color:"#173c58",marginBottom:6}}>🍕 ARTÍCULOS DEL PEDIDO</Text>
   <Text style={{fontSize:11,color:"#5c748a",marginBottom:12}}>Marca pizzas y bebidas si quieres. No hace falta marcar nada para continuar.</Text>
   {hasItems?<>
    {list.map((line,i)=>{
     const category=optionalPackingCategory(line),optional=Boolean(category);
     return <Pressable key={i} disabled={!optional}
       accessibilityRole={optional?"checkbox":undefined}
       accessibilityState={optional?{checked:Boolean(checked[i])}:undefined}
       accessibilityLabel={optional?"Marcar "+category+": "+line.name:undefined}
       onPress={()=>{if(optional)setChecked(old=>({...old,[i]:!old[i]}));}}
       style={{backgroundColor:optional&&checked[i]?"#e4f6ed":"#fff",
        borderColor:optional&&checked[i]?"#a1d7ba":"#dce7f1",
        borderWidth:1,borderRadius:11,padding:12,marginBottom:8,flexDirection:"row",gap:12}}>
       {optional?<Text style={{fontSize:22,color:checked[i]?"#14856a":"#6e8195"}}>{checked[i]?"☑":"□"}</Text>:null}
       <View style={{flex:1}}>
        <Text style={{fontSize:14,fontWeight:"800",color:"#162e45"}}>{line.quantity}× {line.name}</Text>
        {!!line.comments&&<Text style={{fontSize:12,color:"#5b738a"}}>📝 {line.comments}</Text>}
        {(line.modifiers||[]).map((m,j)=><Text key={"m"+j} style={{fontSize:12,color:"#527087"}}>+ {m.quantity||1}× {m.name}</Text>)}
        {(line.children||[]).map((child,j)=><Text key={"c"+j} style={{fontSize:12,color:"#527087"}}>↳ {child.quantity||1}× {child.name}</Text>)}
       </View>
      </Pressable>;
    })}
    <Text style={{fontSize:12,fontWeight:"800",color:"#137a61"}}>
     {optionalIndexes.length?optionalChecked+" de "+optionalIndexes.length+" pizzas/bebidas marcadas · opcional":
       "Sin casillas: el resto de artículos es solo informativo."}
    </Text>
   </>:<Text style={{fontSize:12,color:"#98631d"}}>
    No hay lista digital completa. Puedes consultar el ticket con cocina; no bloquea el reparto.
   </Text>}
  </View>:null}
 <View style={{backgroundColor:order.payment_method==="efectivo"?"#fff3d8":order.payment_method==="tarjeta"?"#e9f3ff":"#f2f3f6",padding:13,borderRadius:10,marginBottom:12}}>
 <Text style={{color:palette.dark,fontWeight:"900"}}>{order.payment_method==="efectivo"?"💶 COLLECT CASH":order.payment_method==="tarjeta"?"💳 CARD PAYMENT":"PAYMENT NOT CLASSIFIED"}</Text>
 <Text style={{color:palette.dark,fontSize:20,fontWeight:"900",marginTop:4}}>{new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(order.amount||0)}</Text>
 </View>
 {String(order.reference||"").startsWith("LA-")&&Number(order.amount)===0?
  <Text style={{color:"#9e5e12",fontWeight:"800",fontSize:12,marginBottom:12}}>⚠ €0 recorded: verify the price in Last.app before collecting payment.</Text>:null}
 {connectedPaymentConfirmation&&status==="entregado"?
  <View style={{borderRadius:14,borderWidth:1,borderColor:"#d4e4ef",backgroundColor:"#f4f9fc",padding:13,marginBottom:13}}>
   <Text style={{fontSize:12,fontWeight:"900",color:"#193953",marginBottom:5}}>PAYMENT AT DELIVERY</Text>
   <Text style={{color:"#58738b",fontSize:11,marginBottom:11}}>Confirm the actual collection method, not the preference from Last.app.</Text>
   {([
    ["efectivo","💶 Cash collected"],
    ["tarjeta","💳 Card collected"],
    ["online","✓ Already paid online · manager review"]
    ] as const).map(([method,label])=>
    <Pressable key={method} accessibilityRole="radio" accessibilityState={{checked:collection===method}}
     onPress={()=>setCollection(method)} style={{padding:13,borderRadius:10,marginBottom:7,
      flexDirection:"row",alignItems:"center",gap:9,
      backgroundColor:collection===method?"#e4f7f0":"#fff",
      borderColor:collection===method?"#1b9679":"#d7e1ec",borderWidth:1}}>
     <Text style={{fontSize:18,color:"#158b70"}}>{collection===method?"◉":"◯"}</Text>
     <Text style={{fontSize:12,fontWeight:"800",color:"#22435d",flex:1}}>{label}</Text>
    </Pressable>)}
   {collection==="online"?
    <Text style={{color:"#955f14",fontSize:11,lineHeight:18}}>El pago online no se cuenta como dinero cobrado por el Rider. Gerencia tendrá que conciliarlo.</Text>:null}
  </View>:null}
 <Text style={s.status}>{order.status.toUpperCase()}</Text>
 <View style={s.inline}><Pressable style={s.outline} onPress={nav}><Text style={s.outlineText}>📍 Google Maps ↗</Text></Pressable>{order.customer_phone?<Pressable style={s.outline} onPress={call}><Text style={s.outlineText}>☎ Call</Text></Pressable>:null}{status?<Pressable disabled={busy||(connectedPaymentConfirmation&&status==="entregado"&&!collection)} style={[s.button,{flex:1}]} onPress={()=>onAdvance(status,collection||undefined)}><Text style={s.buttonText}>{nextLabel[status]}</Text></Pressable>:null}</View>
 </View>
}
const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:"#f7fafc"},top:{backgroundColor:"#fff",padding:20,paddingTop:25,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:"#e2e9ed"},
 back:{color:"#314d63",fontSize:15},brand:{color:"#10243a",fontSize:18,fontWeight:"900",letterSpacing:.3},topSub:{color:"#6c8596",fontSize:10,letterSpacing:1,marginTop:4},
 body:{padding:16,paddingBottom:45},tabBar:{backgroundColor:"#fff",flexDirection:"row",justifyContent:"space-around",borderTopWidth:1,borderTopColor:"#e2e9ee",paddingVertical:8},tab:{flex:1,alignItems:"center",justifyContent:"center",padding:8,gap:3},tabSelected:{backgroundColor:"#eef9f2",borderRadius:10},card:{backgroundColor:"#fff",borderColor:"#dce6ef",borderWidth:1,borderRadius:12,padding:20,marginBottom:14,shadowColor:"#183353",shadowOpacity:.07,shadowRadius:13,shadowOffset:{width:0,height:5},elevation:2},
 eyebrow:{fontSize:10,color:"#5c7d98",fontWeight:"900",letterSpacing:.6,marginBottom:8},title:{fontSize:22,fontWeight:"900",color:palette.dark,marginBottom:9},
 help:{color:palette.muted,fontSize:13,lineHeight:21,marginBottom:15},
 input:{backgroundColor:"#f9fbfd",padding:15,borderRadius:12,borderColor:"#cfdeeb",borderWidth:1,marginVertical:8,fontSize:16,minHeight:50},
 button:{backgroundColor:palette.green,padding:15,borderRadius:12,alignItems:"center",justifyContent:"center"},
 buttonText:{color:"#fff",fontWeight:"900",fontSize:12,textAlign:"center"},inline:{flexDirection:"row",gap:8,marginTop:9,alignItems:"stretch"},
 outline:{padding:13,borderRadius:12,borderWidth:1,borderColor:"#bed1e1",alignItems:"center",justifyContent:"center"},
 outlineText:{color:"#3474a9",fontSize:12,fontWeight:"800"},status:{color:palette.green,fontSize:10,fontWeight:"900",marginBottom:9},
 orderCard:{borderLeftWidth:4,borderLeftColor:"#008b60"},
 loginIntro:{backgroundColor:"#112840",borderRadius:23,padding:27,marginBottom:16},
 loginIntroEyebrow:{color:"#31d3a0",fontWeight:"900",fontSize:10,letterSpacing:1.5,marginBottom:8},
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
