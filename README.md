# Estambul Delivery — V9 rebuild

Branch: `rebuild/staging-first`. PR #34 remains a draft. `main` and production are unchanged.

## Current result

The Last.app ingestion, durable queue and bounded recovery modules from earlier phases remain deployed in the separate staging project. Their synthetic tests and source-preservation checks passed. External Last.app sandbox credentials/location/webhook are still unconfigured.

The new application interfaces are now implemented under `system-v9/web/`:
- Spanish operations Back Office with orders, map, riders, shift closures and settings.
- English mobile rider view with delivery steps, collection/checklist/chat controls and shift closure.
- English single-order customer view with ETA/location presentation, contact/chat and rating.

**The operational application backend is NOT connected or deployed.** Normal mode makes this explicit; live sign-in is disabled. The `?demo=admin`, `?demo=rider&slot=1` through `slot=6`, and `?demo=customer` modes use clearly labelled synthetic in-memory data only. A working demonstration is not a real rider login, a saved financial transaction or a delivered SMS.

## What was tested

Application code `8d9f397ef054fba03a19754f08d1e7864a9cdb57` passed syntax/domain tests, static build and Chromium desktop/mobile checks in run **39501933305**, job **118901319377**. The browser test exercised filter/edit stability, a synthetic delivery/payment/shift cycle, reactivation and safe chat rendering.
The five earlier Last.app workflows also passed on that commit.
Artifact **v9-interfaces-staging** contains the built interface and three screenshots of synthetic desktop/mobile views. It is not a deployed URL or native app binary.

[Application verification and blockers](system-v9/VERIFICATION.md)
[Application source and local commands](system-v9/README.md)
[Prior recovery verification](integrations/lastapp/isolation/recovery/STAGING_VERIFICATION.md)

## External blockers

Vercel installation was confirmed during the session, but its action namespace was not exposed by available tooling. No Vercel deployment action succeeded. The root `vercel.json` only supplies a staging static build configuration.
A backend/authentication/messaging write was blocked by tool security controls and was not forced through an alternative route. `system-v9/database/schema.sql` is an undeployed draft, not an approved migration; read `DO_NOT_DEPLOY.md`.
Real account activation, operational persistence, Last.app sandbox validation, verified SMS delivery and signed native Android/iOS rider apps remain incomplete. No completed production V9 is claimed.

## Retained integration

The two original files `supabase/functions/ed-last-webhook/index.ts` and `supabase/functions/ed-last-auto-sync/index.ts`, all 23 historical migrations in `supabase/migrations`, and the historical Last.app document remain unchanged. Do not run the historical migration directory to install the new isolated modules.
No production database, account, credential, deployed function, schedule or Last.app webhook was modified in this application-interface phase.
