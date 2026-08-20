-- ─────────────────────────────────────────────────────────────────────────────
-- 003 — Administration and specialty apparatus
--
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- The permanent roster (lib/schedule/admin-roster.ts) writes daily_assignments
-- rows for administration, specialty and REACH-1 staff, none of whom appear in
-- the daily PDF. Those inserts are skipped for any apparatus_id absent from the
-- apparatus table, so the units have to exist first.
--
-- ADDS: DFM-6 (a sixth fire marshal, FM6) and INSP-1 / INSP-2 (the two
-- Inspector I positions).
--
-- An earlier version of this file hardcoded status 'active' and failed with
-- "invalid input value for enum apparatus_status". It no longer guesses: the
-- new rows copy type and status from the existing DFM-1 row.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: what does this database actually allow? ──────────────────────────
-- apparatus.status is an enum, so a literal like 'active' fails unless it is
-- one of these. Run this block first and read the values.
SELECT 'status enum' AS check, unnest(enum_range(NULL::apparatus_status))::text AS allowed_value;

-- What the existing administration units look like. The insert below copies
-- type and status from DFM-1 rather than hardcoding them, so the new units are
-- created exactly like their siblings whatever the enum values turn out to be.
SELECT 'existing' AS check, id, call_sign, display_name, type, status, min_staffing, is_reserve
  FROM apparatus
 WHERE id IN ('DFM-1','DFM-2','DFM-3','DFM-4','DFM-5','DFM-6',
              'INSP-1','INSP-2','TR-DC','TR-CPT1','TR-CPT2','TR-AO',
              'EMS-DC','EMS-COORD','EMS-TRN','REACH-1')
 ORDER BY id;

-- ── Step 2: create the units that do not exist yet ───────────────────────────
-- Only DFM-6 and the two inspector positions are genuinely new; the rest are
-- no-ops via ON CONFLICT. type and status are copied from DFM-1, which must
-- already exist — if Step 1 returned no DFM-1 row, stop and say so rather than
-- running this.
INSERT INTO apparatus (id, call_sign, display_name, type, status, min_staffing, is_reserve)
SELECT v.id,
       v.id,
       v.display_name,
       (SELECT type   FROM apparatus WHERE id = 'DFM-1'),
       (SELECT status FROM apparatus WHERE id = 'DFM-1'),
       1,
       false
  FROM (VALUES
          ('DFM-6',  'Deputy Fire Marshal 6'),
          ('INSP-1', 'Inspector I - 1'),
          ('INSP-2', 'Inspector I - 2')
       ) AS v(id, display_name)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification — read-only.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Re-run the "existing" query from Step 1 to confirm all 16 units are there.

-- 2. THE IMPORTANT ONE — do these people exist in the employees table?
--    The roster resolves them by name (with nickname and alias fallbacks).
--    Anyone absent here will be reported as unmatched on the import screen and
--    will not be committed. Expect 16 rows.
SELECT 'employee' AS check, id, first_name, last_name, rank
  FROM employees
 WHERE (first_name ILIKE 'Sean'    AND last_name ILIKE 'Mansfield')
    OR (first_name ILIKE 'Sara'    AND last_name ILIKE 'Roth')
    OR (first_name ILIKE 'Justin'  AND last_name ILIKE 'Guinan')
    OR (first_name ILIKE 'Jordan'  AND last_name ILIKE 'Wakem')
    OR (first_name ILIKE 'Janet'   AND last_name ILIKE 'Campbell')
    OR (first_name ILIKE 'Robert'  AND last_name ILIKE 'Johnson')
    OR (first_name ILIKE 'Diego'   AND last_name ILIKE 'Legorreta')
    OR (first_name ILIKE 'Arthur'  AND last_name ILIKE 'Zhiryada')
    OR (first_name ILIKE 'Michael' AND last_name ILIKE 'Walker')
    OR (first_name ILIKE 'Scott'   AND last_name ILIKE 'Miller')
    OR (first_name ILIKE 'Paul'    AND last_name ILIKE 'Bridgehouse')
    OR (first_name ILIKE 'Matthew' AND last_name ILIKE 'Miller')
    OR (first_name ILIKE 'Stephen' AND last_name ILIKE 'Boughey')
    OR (first_name ILIKE 'Darrin'  AND last_name ILIKE 'George')
    OR (first_name ILIKE 'Katie'   AND last_name ILIKE 'Cardona')
    OR (first_name ILIKE 'Scott'   AND last_name ILIKE 'Alt')
    OR (first_name ILIKE 'Amanda'  AND last_name ILIKE 'Palmer')
 ORDER BY last_name, first_name;
