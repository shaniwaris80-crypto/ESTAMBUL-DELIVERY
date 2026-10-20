# Estambul Delivery V9 Light — staging release gate (20 October 2026)

## Scope
- Preview-only light design, black text, dark green primary buttons and “Diseñado y desarrollado por Arslan W” footer across connected Back Office, Rider and single-order customer tracking.
- Keep Last.app and GloriaFood event handlers, manual dispatch semantics, Supabase schema, authorization, SMS/WhatsApp send logic and live order data unchanged.
- No deployment, schema migration, real customer messaging, branch merge, or production reset authorized by this change.

## Existing features to preserve and verify
- Single-order tracking token is validated by backend; no selector, no ability to enumerate other orders.
- Customer↔rider chat is isolated by order and limited to authenticated/authorized rider and valid tracking token, with rate limits, input validation and expiry.
- Customer calls restaurant at +34 947 009 319; call rider only when business phone set in administration and sharing authorized.
- Six rider accounts: correct current count and enforce account-specific authentication (connected Rider HTML currently renders five quick slots).
- Two **manual** dispatch entry points: Last.app and Back Office. Prevent stale webhook overwrites and display whether dashboard assignment is internal-only (no unverified upstream write).
- ES/EN for all screens and errors; current branch only provides design and signature, full localization still pending.
- Privacy-friendly GPS, limited stale location display; maps/routes need verified Google Maps API configuration and billing.
- Do not claim push notifications or native live activities are live until device tests.

## Staging and release gates
1. Create verified restorable production **database backup** and separate snapshot of last known-good deployment, not just Git branch.
2. Deploy feature branch to **isolated staging**, with separate Supabase credentials, non-production domain and no real customer numbers or messages.
3. Automated: format/lint, compile/typecheck, smoke and E2E across admin, rider, guest; WCAG contrast test incl. status colors; screenshots desktop/tablet/Android/iOS; ES/EN.
4. Security: RLS and token scoping tests with two orders and two riders, unauthenticated isolation, chat cross-order and rate-limiting; XSS inputs; phone-sharing privacy checks.
5. Integration: Last webhook valid/duplicate/out-of-order/cancel/reassign, manual assignment from both surfaces, payment reconciliation; ensure no auto-assignment.
6. Routes and GPS: permission revoke, unavailable/stale coordinates, multiple stops, loss of connection, platform billing protection; no invented ETA.
7. Messaging: consent, template approval and exactly-one-initial-link idempotency under retries. Never send real messages from automated staging tests.
8. Recovery drill restores both deployment and backend; written go/no-go and operator sign-off.
9. **Only then** publish approved tested release and monitor rollback health; no claim of production readiness without evidence.

## Status
UI CSS and signature placed on this branch. Runtime tests, backend chat guarantees, ES/EN, double-manual assignment, Google Maps billing/API integration and full deployment validation **NOT DONE**.
