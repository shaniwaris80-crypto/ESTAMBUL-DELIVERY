/* Last.app v2 finance mapping — pure fixture-level diagnostics.
 * Never sends requests or changes the live SQL importer. */
const cents = v => {
 const n=typeof v==="number"?v:(typeof v==="string"&&/^\d+$/.test(v)?Number(v):NaN);
 return Number.isSafeInteger(n)&&n>=0&&n<=100000000?n:null;
};
const method = s => {
 const v=String(s||"").toLowerCase().trim();
 if(["cash","efectivo"].includes(v))return "efectivo";
 if(["card","tarjeta"].includes(v))return "tarjeta";
 return null;
};
export function analyzeLastFinance(tab){
 const bills=Array.isArray(tab?.bills)?tab.bills.filter(b=>b&&b.deleted!==true):[];
 const totals=bills.map(b=>cents(b.total));
 const billTotalsValid=bills.length>0&&totals.every(n=>n!==null);
 const tabTotal=cents(tab?.total);
 const totalCents=billTotalsValid?totals.reduce((a,b)=>a+b,0):tabTotal;
 const totalSource=billTotalsValid?"bills":tabTotal!==null?"tab_total":"unknown";
 const candidates=[method(tab?.preferredPaymentMethod),
   ...bills.map(b=>method(b.preferredPaymentMethod))].filter(Boolean);
 const unique=[...new Set(candidates)];
 const preference=unique.length===1?unique[0]:null;
 const preferencesConflict=unique.length>1;
 let registeredPayments=0,paidCents=0;
 for(const b of bills){
  for(const payment of Array.isArray(b.payments)?b.payments:[]){
   const value=cents(payment?.amount??payment?.paidAmount);
   if(value!==null&&value>0){registeredPayments++;paidCents+=value;}
  }
 }
 return {totalCents,totalSource,preferredCollectionMethod:preference,
  paidAlready:registeredPayments>0,
  paidCents:registeredPayments?paidCents:null,
  needsPaymentReview:preference===null||preferencesConflict||registeredPayments>0,
  reason:preferencesConflict?"Métodos contradictorios":registeredPayments>0
   ?"Last.app registra pagos; no cobrar de nuevo sin confirmar"
   :preference===null?"Last.app no informa cómo se cobrará":"Preferencia de cobro, no pago confirmado"};
}
