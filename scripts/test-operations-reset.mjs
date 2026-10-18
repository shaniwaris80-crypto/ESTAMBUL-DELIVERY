import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const sql=read("docs/staging/operations-reset-soft-archive-review.sql");
const html=read("live.html"),back=read("docs/live.js"),pwa=read("docs/rider.js"),native=read("apps/rider/lib/connected.ts");
test("reversible reset is genuinely non-destructive and uses cutoff, not DELETE/TRUNCATE",()=>{
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.ed_operations_epoch/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS private\.ed_operations_epoch_audit/);
 assert.doesNotMatch(sql,/^\s*(delete\s+from|truncate\s+table|drop\s+table)\s+(public\.)?ed_orders/mi);
 assert.match(sql,/VALUES\(p_account_id,'reset',v_user,prior_time,new_time\)/);
 assert.match(sql,/VALUES\(p_account_id,'restore',v_user,before_time,restored_time\)/);
});
test("backend requires active admin, exact confirmation and locks account",()=>{
 assert.match(sql,/p_confirmation IS DISTINCT FROM 'REINICIAR'/);
 assert.match(sql,/p_confirmation IS DISTINCT FROM 'RESTAURAR'/);
 assert.match(sql,/m\.role='admin'/);
 assert.match(sql,/FOR UPDATE/);
 assert.match(sql,/auth\.uid\(\)/);
});
test("reset is blocked during rider deliveries and unclosed cash-up",()=>{
 assert.match(sql,/o\.rider_id IS NOT NULL/);
 assert.match(sql,/o\.status IN \('asignado','recogido','en_ruta'\)/);
 assert.match(sql,/ed_shift_closure_items c WHERE c\.order_id=o\.id/);
 assert.match(sql,/Revisa y cierra la caja antes de reiniciar/);
});
test("reset table is read-only for authenticated Rider/admin, RLS scoped to membership",()=>{
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON public\.ed_operations_epoch FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/GRANT SELECT ON public\.ed_operations_epoch TO authenticated/);
 assert.match(sql,/m\.account_id=ed_operations_epoch\.account_id/);
 assert.match(sql,/m\.user_id=\(select auth\.uid\(\)\) AND m\.active/);
 assert.doesNotMatch(sql,/GRANT (INSERT|UPDATE|DELETE|ALL) ON public\.ed_operations_epoch TO authenticated/i);
});
test("admin UI presents two separately guarded actions, not automatic reset",()=>{
 assert.match(html,/id="operationsResetCard" hidden/);
 assert.match(html,/id="resetOperationsButton"[^>]*disabled/);
 assert.match(html,/id="restoreOperationsButton"[^>]*disabled/);
 assert.match(back,/member\.role!=="admin"/);
 assert.match(back,/window\.prompt\("Para confirmar el reinicio.*REINICIAR/);
 assert.match(back,/window\.prompt\("Para recuperar los pedidos anteriores.*RESTAURAR/);
 assert.match(back,/p_confirmation:"REINICIAR"/);
 assert.match(back,/p_confirmation:"RESTAURAR"/);
});
test("admin reset control is disabled while backend migration is absent",()=>{
 assert.match(back,/operationsResetReady=false/);
 assert.match(back,/el\("resetOperationsButton"\)\.disabled=!operationsResetReady/);
 assert.match(back,/falta instalar y verificar la función segura en Supabase/);
});
test("manager order query restricts current period, while historical shift closures remain",()=>{
 assert.match(back,/\/rest\/v1\/ed_operations_epoch\?select=started_at,previous_started_at,revision/);
 assert.match(back,/created_at=gte\./);
 assert.match(back,/epochFilter\+"&order=created_at.desc&limit=100"/);
 assert.match(back,/\/rest\/v1\/ed_shift_closures/);
});
test("Rider PWA respects same cutoff without deleting remote orders",()=>{
 assert.match(pwa,/ed_operations_epoch\?select=started_at/);
 assert.match(pwa,/epochFilter/);
 assert.match(pwa,/created_at=gte\./);
 assert.match(pwa,/catch\(\(\)=>null\)/);
 assert.doesNotMatch(pwa,/ed_reset_operations_view/);
});
test("native Expo Rider respects same cutoff without gaining admin rights",()=>{
 assert.match(native,/ed_operations_epoch\?select=started_at/);
 assert.match(native,/created_at=gte\./);
 assert.match(native,/rider_id=eq\."\+rider\.id\+epochFilter/);
 assert.doesNotMatch(native,/ed_reset_operations_view/);
});
test("LastPOS assignment rules are unchanged",()=>{
 const staff=read("docs/live.js");
 assert.match(staff,/o\.channel!=="test"[\s\S]*?Gestionar en Last\.app/);
 assert.match(staff,/rider_id:rid,status:rid\?"asignado":"pendiente"/);
});
test("no unexpected SMS sender is introduced by reset",()=>{
 for(const p of ["docs/live.js","docs/rider.js","apps/rider/lib/connected.ts"]){
  assert.doesNotMatch(read(p),/ed_send_status_sms|autoDispatchByLocation/);
 }
});
test("SQL is staging-only and does not modify existing receipt/payment tables",()=>{
 assert.match(sql,/STAGING FIRST/);
 assert.match(sql,/restore/);
 assert.doesNotMatch(sql,/DELETE FROM\s+(public\.ed_orders|private\.ed_notification_queue)/i);
 assert.doesNotMatch(sql,/TRUNCATE/i);
});
