/* ESTAMBUL DELIVERY Rider · Aplicación web PWA: datos reales de backend de PRUEBAS.
 * Sin integración Last.app; autentica con Supabase y RLS.
 * No almacena datos de pedidos en el navegador entre sesiones. */
(function () {
"use strict";

const cfg = window.ESTAMBUL_SUPABASE || {};
const base = String(cfg.url || "").replace(/\/+$/, "");
const publicKey = String(cfg.anonKey || "");
const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base) && publicKey.length >= 20;
const $ = id => document.getElementById(id);
const escapeText = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);
const euros = value => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(value || 0));
const statusNames = { pendiente: "Pendiente", asignado: "Asignado", recogido: "Recogido", en_ruta: "En ruta", entregado: "Entregado", cancelado: "Cancelado" };
const channelNames = { test: "Prueba", lastapp: "Last.app", uber: "Uber Eats", justeat: "Just Eat" };
const allowedNext = { asignado: "recogido", recogido: "en_ruta", en_ruta: "entregado" };
const nextNames = { recogido: "Confirmar recogida", en_ruta: "Iniciar reparto", entregado: "Confirmar entrega" };
const storageKey = "estambul-rider-pwa-session";
let session = null, identity = null, rider = null, accountName = "";
let orders = [], busy = false, inFlight = false, showDone = false, lastSync = 0;
let deferredInstall = null;

function getSaved() {
  try {
    const s = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    return s && s.access && s.refresh ? s : null;
  } catch { return null; }
}
function setSaved(s) {
  session = s;
  if (s) sessionStorage.setItem(storageKey, JSON.stringify(s));
  else sessionStorage.removeItem(storageKey);
}
function heads() { return { "apikey": publicKey, "Content-Type": "application/json" }; }
async function jsonResponse(response) {
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok) {
    throw new Error(data && (data.msg || data.message || data.error_description || data.error) || "Error de conexión (" + response.status + ")");
  }
  return data;
}
async function refreshToken() {
  if (!session || !session.refresh) throw new Error("La sesión ha caducado. Inicia sesión de nuevo.");
  const data = await jsonResponse(await fetch(base + "/auth/v1/token?grant_type=refresh_token", {
    method: "POST", headers: heads(), body: JSON.stringify({ refresh_token: session.refresh })
  }));
  setSaved({ access: data.access_token, refresh: data.refresh_token, expiry: Date.now() + data.expires_in * 1000 });
}
async function withAuth(path, options) {
  if (!session) throw new Error("Necesitas iniciar sesión.");
  if (!session.expiry || Date.now() >= session.expiry - 60000) await refreshToken();
  const headers = { ...heads(), "Authorization": "Bearer " + session.access, ...(options && options.headers || {}) };
  let resp = await fetch(base + path, { ...(options || {}), headers });
  if (resp.status === 401) {
    await refreshToken();
    headers.Authorization = "Bearer " + session.access;
    resp = await fetch(base + path, { ...(options || {}), headers });
  }
  return jsonResponse(resp);
}
function setVisible(view) {
  ["loading", "login", "dashboard", "setup"].forEach(id => { $(id).hidden = id !== view; });
}
function setError(message, loginError) {
  const el = $(loginError ? "loginError" : "connectionNotice");
  el.textContent = message;
  el.hidden = false;
}
function clearError() {
  $("loginError").hidden = true;
  $("connectionNotice").hidden = true;
}
function resetLocal() {
  setSaved(null);
  identity = null; rider = null; orders = []; accountName = "";
  $("password").value = "";
  clearError();
  setVisible("login");
}
async function authenticate() {
  const user = await withAuth("/auth/v1/user");
  const membership = await withAuth("/rest/v1/ed_members?select=account_id,role,active&user_id=eq." + encodeURIComponent(user.id) + "&active=eq.true");
  const assignment = Array.isArray(membership) ? membership.find(row => row.role === "rider") : null;
  if (!assignment) throw new Error("Esta cuenta no está autorizada como repartidor. Pide al administrador que te vincule.");
  const accountId = encodeURIComponent(assignment.account_id);
  const [myRiders, accounts] = await Promise.all([
    withAuth("/rest/v1/ed_riders?select=id,display_name,online,active,user_id&account_id=eq." + accountId),
    withAuth("/rest/v1/ed_accounts?select=id,name&id=eq." + accountId)
  ]);
  const current = myRiders.find(row => row.user_id === user.id && row.active);
  if (!current) throw new Error("Tu rider todavía no está activo en el sistema.");
  identity = { userId: user.id, accountId: assignment.account_id };
  rider = current;
  accountName = accounts && accounts[0] ? accounts[0].name : "ESTAMBUL DELIVERY";
}
async function fetchOrders() {
  const endpoint = "/rest/v1/ed_orders?select=id,reference,channel,customer_name,destination,amount,status,rider_id,lat,lng,created_at&account_id=eq." +
    encodeURIComponent(identity.accountId) + "&rider_id=eq." + encodeURIComponent(rider.id) + "&order=created_at.desc&limit=100";
  const response = await withAuth(endpoint);
  orders = Array.isArray(response) ? response : [];
  lastSync = Date.now();
  draw();
}
async function updateOrders() {
  if (inFlight || busy || !identity || document.visibilityState !== "visible") return;
  inFlight = true;
  try {
    await fetchOrders();
    $("connectionNotice").hidden = true;
  } catch (error) {
    setError("Sin conexión: " + (error.message || "Inténtalo de nuevo."), false);
  } finally { inFlight = false; }
}
function draw() {
  if (!rider) return;
  $("riderName").textContent = rider.display_name;
  $("accountName").textContent = accountName + " · Cuenta individual";
  $("onlineLight").classList.toggle("active", Boolean(rider.online));
  $("onlineLabel").textContent = rider.online ? "Estoy disponible" : "No disponible";
  $("availabilityButton").setAttribute("aria-pressed", rider.online ? "true" : "false");
  const open = orders.filter(o => !["entregado", "cancelado"].includes(o.status));
  $("pendingCount").textContent = open.length;
  $("routeCount").textContent = open.filter(o => o.status === "en_ruta").length;
  $("doneCount").textContent = orders.filter(o => o.status === "entregado").length;
  $("listCount").textContent = showDone ? orders.length : open.length;
  const shown = showDone ? orders.filter(o => o.status !== "cancelado") : open;
  $("orders").innerHTML = shown.length ? shown.map(renderOrder).join("") :
    '<div class="empty"><span class="empty-icon">📦</span><strong>Sin entregas asignadas</strong><p>Cuando el supervisor te asigne un pedido, aparecerá aquí automáticamente al actualizar.</p></div>';
  $("syncStamp").textContent = "Actualizado a las " + new Date(lastSync).toLocaleTimeString("es-ES");
}
function mapUrl(order) {
  if (order.lat == null || order.lng == null) return "";
  return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(order.lat + "," + order.lng) + "&travelmode=driving";
}
function renderOrder(order) {
  const nextStatus = allowedNext[order.status];
  const destination = mapUrl(order);
  const button = nextStatus ? '<button type="button" data-order="' + escapeText(order.id) + '" data-next="' + nextStatus + '">' +
    escapeText(nextNames[nextStatus]) + ' →</button>' : "";
  return '<article class="order-card"><div class="order-top"><div><span class="order-number">#' + escapeText(order.reference) +
    '</span><span class="channel">' + escapeText(channelNames[order.channel] || order.channel) +
    '</span></div><span class="status ' + escapeText(order.status) + '">' + escapeText(statusNames[order.status] || order.status) +
    '</span></div><h3 class="destination-head">' + escapeText(order.customer_name) + '</h3><p class="destination">📍 ' +
    escapeText(order.destination) + '</p><p class="payment">Importe de prueba: <strong>' + euros(order.amount) +
    '</strong></p><div class="actions">' + (destination ? '<a href="' + destination +
    '" target="_blank" rel="noopener noreferrer">↗ Google Maps</a>' : "") + button + '</div></article>';
}
async function operation(fn) {
  if (busy) return;
  busy = true; clearError();
  $("availabilityButton").disabled = true; $("refreshButton").disabled = true;
  document.querySelectorAll("[data-order]").forEach(button => { button.disabled = true; });
  try {
    await fn();
    await fetchOrders();
  } catch (error) {
    setError(error.message || "No se ha podido completar la operación.", false);
    await updateOrders();
  } finally {
    busy = false;
    $("availabilityButton").disabled = false; $("refreshButton").disabled = false;
  }
}
async function signIn(email, password) {
  const response = await jsonResponse(await fetch(base + "/auth/v1/token?grant_type=password", {
    method: "POST", headers: heads(), body: JSON.stringify({ email, password })
  }));
  setSaved({ access: response.access_token, refresh: response.refresh_token, expiry: Date.now() + response.expires_in * 1000 });
  await authenticate();
  await fetchOrders();
  clearError(); setVisible("dashboard"); $("password").value = "";
}
$("loginForm").addEventListener("submit", async e => {
  e.preventDefault(); if (busy) return;
  busy = true; clearError(); $("loginButton").disabled = true;
  try { await signIn($("email").value.trim(), $("password").value); }
  catch (error) {
    // Fail-closed: never keep a session that is not an authorized rider.
    setSaved(null); identity = null; rider = null; orders = [];
    setError(error.message || "No se ha podido iniciar sesión.", true);
  } finally { busy = false; $("loginButton").disabled = false; }
});
$("availabilityButton").addEventListener("click", () => {
  if (!rider) return;
  const newOnline = !rider.online;
  void operation(async () => {
    const rows = await withAuth("/rest/v1/ed_riders?id=eq." + encodeURIComponent(rider.id), {
      method: "PATCH", headers: { "Prefer": "return=representation" }, body: JSON.stringify({ online: newOnline })
    });
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("La disponibilidad no pudo actualizarse.");
    rider.online = Boolean(rows[0].online);
  });
});
$("refreshButton").addEventListener("click", () => void operation(async () => {}));
$("showDone").addEventListener("change", e => { showDone = Boolean(e.target.checked); draw(); });
$("orders").addEventListener("click", event => {
  const button = event.target.closest("button[data-order]");
  if (!button || !rider || busy) return;
  const order = orders.find(row => row.id === button.dataset.order);
  const status = button.dataset.next;
  if (!order || allowedNext[order.status] !== status) return;
  void operation(async () => {
    const filter = "?id=eq." + encodeURIComponent(order.id) +
      "&rider_id=eq." + encodeURIComponent(rider.id) +
      "&status=eq." + encodeURIComponent(order.status);
    const rows = await withAuth("/rest/v1/ed_orders" + filter, {
      method: "PATCH", headers: { "Prefer": "return=representation" }, body: JSON.stringify({ status })
    });
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new Error("El pedido ha sido reasignado o cambiado. Actualiza y vuelve a intentarlo.");
    }
  });
});
$("logoutButton").addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  try {
    if (session) await withAuth("/auth/v1/logout", { method: "POST" });
  } catch {} finally { busy = false; resetLocal(); }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && identity) void updateOrders();
});
setInterval(() => { if (identity) void updateOrders(); }, 5000);
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstall = event; $("installButton").hidden = false;
});
$("installButton").addEventListener("click", async () => {
  if (!deferredInstall) return;
  const prompt = deferredInstall; deferredInstall = null; $("installButton").hidden = true;
  await prompt.prompt();
});
window.addEventListener("appinstalled", () => { $("installButton").hidden = true; });
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./rider-sw.js").catch(() => {});
  });
}
async function start() {
  if (!configured) { setVisible("setup"); return; }
  session = getSaved();
  if (!session) { setVisible("login"); return; }
  try {
    await authenticate(); await fetchOrders(); setVisible("dashboard");
  } catch {
    // Session not authorized or expired: require sign-in again, without exposing another user's data.
    resetLocal();
  }
}
void start();
})();