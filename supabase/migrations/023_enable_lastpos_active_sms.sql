-- No retroactive SMS opt-in/backfill.
-- Migration 021 enables the single tracking-link SMS for future eligible
-- LastPOS/GloriaFood imports. Existing rows do not store the verified source
-- phone and consent needed for a safe backfill, so leave them unchanged.
-- No SMS is sent by this migration.
BEGIN;
COMMIT;
