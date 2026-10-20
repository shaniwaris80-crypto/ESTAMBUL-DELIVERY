# Application interface verification — 20 October 2026

## Scope and exact source

Repository: `shaniwaris80-crypto/ESTAMBUL-DELIVERY`.
Branch: `rebuild/staging-first`; PR #34 remains a draft.
Tested application code commit: `8d9f397ef054fba03a19754f08d1e7864a9cdb57`.
No production deployment, database mutation or account activation was performed in this application-interface phase.

The backend/identity/messaging code write attempted during this phase was blocked by tool security controls. It was NOT applied by another route. Only independent web interface code, synthetic-only tests, build configuration and this documentation were subsequently saved. The operational SQL file from the earlier draft remains UNDEPLOYED and must not be installed.

## Actual successful workflow

`V9 application interfaces`, run **39501933305**, job **118901319377**, completed **SUCCESS**.
Verified step results: Last.app source preservation; syntax and domain tests; staging static build; Chromium desktop/mobile checks; artifact upload.

Browser checks actually performed:
- Disconnected landing screen does not offer a successful real login.
- Spanish Back Office renders four synthetic orders and six synthetic rider cards.
- Search filters orders correctly.
- An amount being edited remains unchanged across the five-second refresh interval.
- English rider view completes a synthetic start -> card collection -> slide delivery -> shift closure sequence.
- Synthetic shift closure sets the rider offline; going online again works.
- English customer layout renders at mobile width without horizontal overflow.
- Customer chat displays `<script>` literally instead of inserting an executable element.
- No page-level JavaScript errors in the checked browser session.
- Separate domain regressions protect unknown amounts, integer cents, stale versions, shift balance separation, active-order blocking, stale GPS, escaped content and text-only map tooltips.

These are UI/domain tests using `createDemo`, an explicitly labelled in-memory synthetic transport. They DO NOT test real Auth, Supabase operational persistence, actual customer-token isolation, Last.app sandbox, SMS delivery, native background GPS or push notifications. Browser GPS behaviour on locked physical phones has not been verified.

The five earlier Last.app workflows also completed SUCCESS for the same source:
- preservation: 39501933359
- isolated ingestion: 39501933304
- recovery and retention: 39501933379
- HTTP staging: 39501933306
- durable queue: 39501933331

## Generated package

GitHub Actions artifact: **v9-interfaces-staging**, ID **12302575145**, **606415 bytes**.
Digest: `sha256:bd122eee219f73de012315b6291ccb457ef4ef84b2d0b4404d803a69d65f5b26`.
Retained until **3 November 2026** according to artifact metadata.
Contains the static web output and three screenshots captured from the implemented UI: Back Office desktop, rider mobile and customer mobile. All screenshots contain synthetic data only.
The artifact is NOT a deployed website or an Android/iOS binary. Its bytes were not downloaded into the chat container; do not invent a sandbox download path for it.

## Vercel installation and unresolved tool exposure

The user installed Vercel during this phase. Plugin Management confirmed `installed=true`.
Both `Vercel` and `vercel` resource discovery attempts returned no tool namespace; the available namespace list did not include it. No Vercel deployment action was accessible in this session. GitHub reported no combined commit statuses for a Vercel preview on the tested commit. This is not proof that the user's account has no other deployments.
`vercel.json` is a ready static build configuration; it is not evidence of publication. No new live URL is claimed.

## Verified preserved deployment state

A final Supabase Edge-function inventory showed the existing staging functions `ed-rider-accept-sms` v2, `ed-twilio-status` v1, `edv9-last-gateway` v1 and `edv9-last-queue` v2. No new `edv9-app` service was deployed.
`main` was read again and remains at `ba3863c654e4535af64d715c405bb854bfef7db8`.

## Remaining work — not completed

1. Review the operational SQL draft and implement/deploy the authenticated server through permitted tooling; perform real persistence and cross-user authorization tests.
2. Verify sign-in/activation of the real admin and six rider accounts. The six demo riders are not account activations.
3. Configure and validate Last.app sandbox credentials, approved location and a separate webhook without replacing production.
4. Complete the reviewed single-message outbox/provider integration and verify delivery to one controlled consented number; no real SMS was sent here.
5. Deploy a staging Vercel preview once its actions are actually available, then verify the exact URL and the connected user flows.
6. Implement/integrate and build the native rider client, with signed Android/iOS builds and physical-device background GPS/push testing.

This is a partially completed rebuild with tested interfaces, not a completed V9 production system.
