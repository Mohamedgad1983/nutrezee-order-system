-- 0023_address_block.sql
-- Structured Kuwait BLOCK (qita) column for `address`. The legacy "User Details"
-- <address> element renders the block as an UNLABELLED number between "Building Name :"
-- and "Street :" (verified vs 20 live legacy pages 2026-06-26 = 14/14 = 100%). The old
-- flattener merged it into block_floor_raw = "<building>, <block>", so for already-imported
-- rows the block is recoverable as the 2nd number of block_floor_raw (no re-scrape needed).
-- Idempotent (IF NOT EXISTS); applied to staging 2026-06-26 (recorded in schema_migrations).
ALTER TABLE address ADD COLUMN IF NOT EXISTS block text;

COMMENT ON COLUMN address.block IS
  'Kuwait block (qita). Derived 2026-06-26 from block_floor_raw 2nd number; the legacy <address> renders it UNLABELLED between Building Name and Street. Verified vs 20 live legacy pages (14/14=100%).';

-- Data backfill applied by ops/legacy-address-backfill (block-derive). For a fresh DB this
-- column starts NULL and is populated by that step; included here only as documentation:
--   WITH d AS (SELECT id, substring(block_floor_raw from '([0-9]+)[^0-9]*$') AS blk
--              FROM address WHERE block_floor_raw ~ ',')
--   UPDATE address a SET block = d.blk FROM d
--   WHERE a.id=d.id AND a.block IS NULL AND d.blk ~ '^[0-9]{1,3}$' AND d.blk::int <= 199;
