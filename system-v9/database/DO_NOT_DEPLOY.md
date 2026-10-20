# Operational schema draft — DO NOT DEPLOY

`schema.sql` was saved as an initial design draft only. It has not been installed remotely, connected to an authenticated server, or passed the operational PostgreSQL integration suite. The application-interface workflow does not execute it.

Known review requirements include explicit NULL rejection for administrative archive confirmation, payment method, push tokens and GPS accuracy; a durable tracking-link issuance path when the origin is not configured at acceptance; financial correction/review workflow; narrow verified identity binding; complete concurrent/idempotent transition tests; token revocation and privacy checks; single-message provider outcome reconciliation; and a retention policy for real operational data.

Do not expose its server-only procedures to anon/authenticated and do not treat a frontend validation check as server authorization. Do not run this draft to work around the tool-blocked backend/authentication/messaging write. The existing deployed Last.app staging modules are separate and remain unchanged.
