/** Isolated server-side ingestion contract. No SDK, network, secrets or side effects on import. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENTS = new Set(['tab:created','tab:updated','tab:closed','tab:cancelled','tab:delivery-status-updated']);
const STATUSES = new Set(['CREATED','KITCHEN','READY_TO_PICKUP','ON_DELIVERY','DELIVERED','CLOSED']);
const ERRORS = new Set(['last_unauthorized','last_not_found','last_rate_limited','last_unavailable','last_timeout','invalid_tab','worker_error']);
const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' ? x : null;
const id = x => typeof x === 'string' && UUID.test(x) ? x.toLowerCase() : null;
const cents = x => Number.isSafeInteger(x) && x >= 0 ? x : null;
function timestamp(x) {
  return typeof x === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(x) && Number.isFinite(Date.parse(x)) ? new Date(x).toISOString() : null;
}
function invalid() { const error = new Error('invalid_tab'); error.code = 'invalid_tab'; throw error; }

/** p_location_id comes from the authenticated HTTP boundary, never the browser. */
export function parseEvent(payload, headers) {
  if (!object(payload) || !object(headers) || !text(payload.id) || payload.id.length > 128 || !text(payload.type)) throw new Error('invalid_event');
  const locationId = id(headers.locationId);
  if (!locationId) throw new Error('location_required');
  if (!EVENTS.has(payload.type)) return { supported: false, event_type: payload.type };
  if (!object(payload.data)) throw new Error('invalid_event');
  const data = payload.data;
  if (data.locationId != null && id(data.locationId) !== locationId) throw new Error('location_mismatch');
  const organizationId = headers.organizationId == null ? null : id(headers.organizationId);
  if (headers.organizationId != null && !organizationId) throw new Error('invalid_organization');
  if (data.organizationId != null && (!id(data.organizationId) || (organizationId && id(data.organizationId) !== organizationId))) throw new Error('organization_mismatch');
  const tabId = id(payload.type === 'tab:delivery-status-updated' ? data.tabId : data.id);
  if (!tabId || (payload.created != null && !timestamp(payload.created))) throw new Error('invalid_event');
  return { supported: true, event_id: payload.id, event_type: payload.type, tab_id: tabId,
    location_id: locationId, organization_id: organizationId ?? id(data.organizationId), raw: payload };
}

/** Internal model derived from the uploaded Last.app v2 contract, not a vendor payload. */
export function normalizeTab(tab, expected) {
  if (!object(tab) || !object(expected) || !id(expected.tabId) || !id(expected.locationId)
    || id(tab.id) !== id(expected.tabId) || id(tab.locationId) !== id(expected.locationId)) invalid();
  const delivery = object(tab.delivery) ? tab.delivery : null;
  const isDelivery = ['delivery','owndelivery'].includes(String(tab.pickupType).toLowerCase()) && !!delivery;
  const warnings = [];
  const customer = object(tab.customerInfo) ? tab.customerInfo : {};
  const courier = delivery && object(delivery.courier) ? delivery.courier : {};
  const bills = Array.isArray(tab.bills) ? tab.bills : [];
  let total = bills.length ? 0 : null;
  const billIds = new Set(), paymentIds = new Set(), payments = [], preferred = new Set();
  for (const bill of bills) {
    if (!object(bill) || !text(bill.id) || billIds.has(bill.id) || cents(bill.total) === null || bill.rectifiedBillNumber != null) {
      total = null; warnings.push('financial_review_required');
    } else if (total !== null) {
      total += bill.total;
      if (!Number.isSafeInteger(total)) { total = null; warnings.push('financial_review_required'); }
    }
    if (!object(bill)) continue;
    billIds.add(bill.id);
    if (text(bill.preferredPaymentMethod)) preferred.add(bill.preferredPaymentMethod);
    if (Array.isArray(bill.payments)) for (const payment of bill.payments) {
      if (!object(payment) || payment.deleted === true) continue;
      if (!text(payment.id) || paymentIds.has(payment.id) || cents(payment.amount) === null) {
        warnings.push('payment_review_required'); continue;
      }
      paymentIds.add(payment.id);
      payments.push({ id: payment.id, bill_id: bill.id, type: text(payment.type), amount_cents: payment.amount,
        tip_cents: cents(payment.tip), change_cents: cents(payment.change) });
    }
  }
  let sourceStatus = null;
  const statuses = delivery && Array.isArray(delivery.statuses) ? delivery.statuses : [];
  const validStatuses = statuses.filter(s => object(s) && timestamp(s.creationTime)).sort((a,b) => Date.parse(b.creationTime)-Date.parse(a.creationTime));
  if (validStatuses.length) {
    const latest = validStatuses[0];
    const conflict = validStatuses.some(s => Date.parse(s.creationTime) === Date.parse(latest.creationTime) && s.status !== latest.status);
    if (conflict || !STATUSES.has(latest.status)) warnings.push('delivery_status_review_required');
    else sourceStatus = latest.status;
  }
  if (tab.cancelTime != null) {
    if (timestamp(tab.cancelTime)) sourceStatus = 'CANCELLED';
    else warnings.push('cancellation_review_required');
  }
  const coordinate = (v,min,max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
  const lat = coordinate(delivery?.latitude,-90,90), lng = coordinate(delivery?.longitude,-180,180);
  return {
    contract_version: 1, external_order_id: id(tab.id), location_id: id(tab.locationId),
    source: text(tab.source), source_code: text(tab.code), is_delivery: isDelivery,
    customer: isDelivery ? { name: text(customer.name), surname: text(customer.surname), phone: text(customer.phoneNumber) } : null,
    destination: isDelivery ? { address: text(delivery.address), details: text(delivery.details), lat: lat !== null && lng !== null ? lat : null, lng: lat !== null && lng !== null ? lng : null } : null,
    courier: { external_id: text(courier.id), name: text(courier.name) },
    source_status: sourceStatus, total_cents: total, recorded_payments: payments,
    preferred_payment_method: preferred.size === 1 ? [...preferred][0] : null,
    rider_collected_cents: null,
    products: Array.isArray(tab.products) ? tab.products.filter(p => object(p) && p.deleted !== true) : [],
    warnings: [...new Set(warnings)]
  };
}

/** Ports are supplied by a future backend adapter. Claim/fencing lives in PostgreSQL.
 * No source.created-based ordering: an old event still triggers a CURRENT full-tab read.
 * Caller must provide a bounded Last reader; no endless network wait is permitted.
 */
export async function processOne({store, last}, locationId) {
  if (!id(locationId)) throw new Error('invalid_location');
  const claim = await store.claim(locationId);
  if (!claim) return { state: 'idle' };
  try {
    const tab = await last.getTab(claim.tab_id, claim.location_id, { timeoutMs: 12000 });
    const normalized = normalizeTab(tab, { tabId: claim.tab_id, locationId: claim.location_id });
    const state = await store.complete(claim.event_id, claim.lease_token, tab);
    return { state, normalized: state === 'processed' ? normalized : null };
  } catch (error) {
    const code = ERRORS.has(error?.code) ? error.code : 'worker_error';
    const retryAfter = Number.isInteger(error?.retryAfterSeconds) ? Math.max(0,Math.min(86400,error.retryAfterSeconds)) : 0;
    const state = await store.fail(claim.event_id, claim.lease_token, code, retryAfter);
    return { state, error_code: code };
  }
}
