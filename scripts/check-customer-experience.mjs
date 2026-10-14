/* Non-invasive checks for customer tracking and admin GPS.
 * Run: node scripts/check-customer-experience.mjs
 * No credentials, SMS traffic or database access.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const read = p => readFileSync(new URL('../'+p, import.meta.url),'utf8');
const customer = read('track.html');
const track = read('docs/track.js');
const live = read('live.html');
const rider = read('docs/rider.js');
const sms = read('supabase/functions/ed-rider-accept-sms/index.ts');
const cases = [
  ['Private URL not indexed', customer.includes('noindex,nofollow')],
  ['Tracking token in URL fragment', track.includes('location.hash')],
  ['Authenticated status retrieval endpoint', track.includes('ed_public_track')],
  ['Private feedback by token', track.includes('ed_submit_feedback')],
  ['Customer contact action exists', customer.includes('restaurant-call')],
  ['Customer receives offline indication', customer.includes('id="connectionNotice"') && track.includes('el("connectionNotice").hidden=false')],
  ['Map hidden without current authorized GPS', track.includes('el("liveMapPanel").hidden=!hasGps')],
  ['Tracking verifies order in route', track.includes('data.status==="en_ruta"')],
  ['No stale rider marker retained', track.includes('removeAttribute("src")')],
  ['SMS integration only sends with customer authorization', sms.includes('order.notifications_consent') && sms.includes('order.notification_channel!=="sms"')],
  ['Twilio network call has a bounded timeout', sms.includes('signal:AbortSignal.timeout(12000)')],
  ['Twilio remains controlled by server-side feature flag', sms.includes('ESTAMBUL_MESSAGING_ENABLED')],
  ['Revoked token clears previously rendered private map', track.includes('current=null;') && track.includes('el("orderContent").hidden=true;')],
  ['Stale live map is hidden on connection loss', track.includes('A failed poll must not leave an old GPS marker') && track.includes('el("liveMapPanel").hidden=true')],
  ['Admin includes rider location section', live.includes('id="gpsAdminCard"')],
  ['Rider has location control', rider.includes('geolocation')],
  ['Token not appended as search parameter', !track.includes('searchParams.set("token"')]
];
for(const [description,ok] of cases){
  process.stdout.write((ok?'PASS':'FAIL')+' '+description+'\n');
}
assert.equal(cases.filter(([,ok])=>!ok).length,0,'Customer experience checks failed');
console.log('17 structural customer-experience checks passed. These are not end-to-end integration tests.');
