# Estambul Delivery V9 — application implementation

Work remains in `rebuild/staging-first`. No production changes or replacement of the retained Last.app functions.

## What is actually in this directory

`web/` is the implemented responsive interface, not an image mockup: Spanish Back Office, English rider and customer screens. It includes operations, filters, map, exact Last courier mapping form, order details, collection forms, item checklist, chat, location controls, shift closure, CSV/print reports, archive controls and customer rating.

`database/schema.sql` is a first operational SQL draft. It is NOT a deployed schema and is NOT ready for live use. The application authentication/backend/messaging write attempted in this session was blocked by tool security controls; it was not applied through another route. Do not run this draft on any remote database. There is no newly deployed `edv9-app` service.

The normal interface explicitly says the operational backend is disconnected and disables real sign-in. `transport.mjs` is an integration port for a reviewed authenticated adapter; it does not invent successful operations. An adapter must validate identity/authorization, persist operations and provide explicit results before live mode is enabled.

The `?demo=admin`, `?demo=rider&slot=1` … `slot=6`, and `?demo=customer` views are EXPLICIT in-memory demonstrations using synthetic names/addresses. They do not call Last.app, Supabase Auth, Twilio or any operational database. Reloading resets demo changes. A demo is not evidence of successful real login, SMS delivery, private tracking authorization or financial persistence.

## Run and build

```sh
node system-v9/scripts/serve.mjs
# Open http://localhost:4173/?demo=admin
node --test system-v9/tests/*.test.mjs
node system-v9/scripts/build.mjs
```

There are no runtime npm dependencies. Leaflet 1.9.4 is loaded from its documented CDN with integrity hashes; OSM map tiles require connectivity. The app works without the map library and keeps addresses visible. No map/location fallback invents a rider position.

`vercel.json` builds this directory to `dist-v9`, with no production deployment workflow. Configure a NEW staging project or branch preview; do not replace an existing production project. Installing the Vercel plugin alone is not proof of a deployment. A live URL and READY deployment status must be verified before claiming publication.

## Preserved behaviour in the UI

Rider/customer text is English only. Back Office is Spanish. Background refresh does not replace active edit fields or an open order dialog. Version values are included with order changes so a reviewed server can reject stale writes. Cash/card/online are displayed separately; missing amounts are not zero. A shift with pending deliveries or unresolved payments is blocked. The archive control does not claim to delete data.

Customer tracking is limited to the data returned for one order by the adapter. GPS/ETA is hidden when missing/stale. ETA is a clearly labelled heuristic, not a traffic service. Route ordering is nearest-neighbour and not optimal road routing. Customer phone links are restricted to valid international phone numbers. Chat text and source order fields are escaped, never executed as markup.

The service worker caches PUBLIC shell files only, not order details, credentials, tracking capabilities, API requests or map tiles. Offline mutations are blocked rather than reported as saved.

## Explicit blockers and incomplete work

Operational API/authentication and real SMS remain blocked/not deployed. Last.app sandbox token/localisation/webhook remain unconfigured from earlier phases. Native Android/iOS signed binaries and background GPS/push validation have not been produced. UI/browser tests use a synthetic transport, not a real rider session. Financial SQL draft requires full review and integration tests before remote installation.

The user installed Vercel during this session; Plugin Management reports installed=true, but this session's `api_tool` resource discovery still does not expose a Vercel namespace. No Vercel deployment action has succeeded. Do not describe `vercel.json`, build output or demo pages as an already published application.
