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
-- Inspector I positions). The remaining IDs already existed; the inserts below
-- are no-ops for those.
--
-- CHECK BEFORE RUNNING: the column list is written against the columns the
-- crew board reads. Compare against your table and drop any this does not have.
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns WHERE table_name = 'apparatus';
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO apparatus (id, call_sign, display_name, type, status, min_staffing, is_reserve)
VALUES
  -- Community Risk Reduction
  ('DFM-1',     'DFM-1',     'Fire Marshal',       'special', 'active', 1, false),
  ('DFM-2',     'DFM-2',     'Deputy Fire Marshal 2', 'special', 'active', 1, false),
  ('DFM-3',     'DFM-3',     'Deputy Fire Marshal 3', 'special', 'active', 1, false),
  ('DFM-4',     'DFM-4',     'Deputy Fire Marshal 4', 'special', 'active', 1, false),
  ('DFM-5',     'DFM-5',     'Deputy Fire Marshal 5', 'special', 'active', 1, false),
  ('DFM-6',     'DFM-6',     'Deputy Fire Marshal 6', 'special', 'active', 1, false),
  ('INSP-1',    'INSP-1',    'Inspector I - 1',    'special', 'active', 1, false),
  ('INSP-2',    'INSP-2',    'Inspector I - 2',    'special', 'active', 1, false),
  -- Training division
  ('TR-DC',     'TR-DC',     'DC of Training',     'special', 'active', 1, false),
  ('TR-CPT1',   'TR-CPT1',   'Training Officer 2', 'special', 'active', 1, false),
  ('TR-CPT2',   'TR-CPT2',   'Training Officer 3', 'special', 'active', 1, false),
  ('TR-AO',     'TR-AO',     'Training Officer 4', 'special', 'active', 1, false),
  -- EMS division
  ('EMS-DC',    'EMS-DC',    'DC of EMS',          'special', 'active', 1, false),
  ('EMS-COORD', 'EMS-COORD', 'EMS Coordinator',    'special', 'active', 1, false),
  ('EMS-TRN',   'EMS-TRN',   'EMS Trainer',        'special', 'active', 1, false)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification — read-only.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Every apparatus the permanent roster writes to. Expect 16 rows
--    (15 above plus REACH-1). A missing row means those assignments are
--    silently skipped at import.
SELECT 'apparatus' AS check, id, display_name, type, status
  FROM apparatus
 WHERE id IN ('DFM-1','DFM-2','DFM-3','DFM-4','DFM-5','DFM-6',
              'INSP-1','INSP-2',
              'TR-DC','TR-CPT1','TR-CPT2','TR-AO',
              'EMS-DC','EMS-COORD','EMS-TRN','REACH-1')
 ORDER BY id;

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
