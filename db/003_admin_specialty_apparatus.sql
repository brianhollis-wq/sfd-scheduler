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
-- ADDS: DFM-6 (a sixth fire marshal, FM6), INSP-1 / INSP-2 (the two Inspector I
-- positions), the four EMS division support posts, and the administration units
-- for the Office of the Fire Chief, Emergency Operations Division, Business
-- Operations Division and Emergency Management.
--
-- An earlier version hardcoded status 'active' and failed with "invalid input
-- value for enum apparatus_status"; the new rows now copy type and status from
-- the existing DFM-1 row instead of guessing. A later version failed with
-- "operator does not exist: integer = record" because the Logistics apparatus
-- tuples had been pasted into the employee ID list further down. Both are
-- fixed here.
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
              'INSP-1','INSP-2',
              'TR-DC','TR-CPT1','TR-CPT2','TR-AO','TR-SA',
              'EMS-DC','EMS-COORD','EMS-TRN','EMS-PDA1','EMS-PDA2','EMS-BILL','EMS-SA',
              'LOG-ANL','LOG-FB','LOG-EB',
              'C-1','C-2','C-3','C-4','DC-OPS','EM-1',
              'FCO-1','FCO-2','BOD-1','BOD-2',
              'REACH-1')
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
          -- Community Risk Reduction
          ('DFM-6',    'Deputy Fire Marshal 6'),
          ('INSP-1',   'Inspector I - 1'),
          ('INSP-2',   'Inspector I - 2'),
          -- Training division
          ('TR-SA',    'Training Division Staff'),
          -- EMS division
          ('EMS-PDA1', 'Paramedic Data Analyst 1'),
          ('EMS-PDA2', 'Paramedic Data Analyst 2'),
          ('EMS-BILL', 'Billing Specialist'),
          ('EMS-SA',   'EMS Staff Assistant'),
          -- Logistics division
          ('LOG-ANL',  'Logistics Management Analyst'),
          ('LOG-FB',   'Fire Buyer'),
          ('LOG-EB',   'EMS Buyer'),
          -- Office of the Fire Chief
          ('C-1',      'Fire Chief'),
          ('FCO-1',    'Fire Chief''s Office Staff 1'),
          ('FCO-2',    'Fire Chief''s Office Staff 2'),
          -- Emergency Operations Division
          ('C-2',      'Assistant Chief of Operations'),
          ('DC-OPS',   'Deputy Chief of Operations'),
          ('C-4',      'Deputy Chief of Special Projects'),
          -- Business Operations Division
          ('C-3',      'Assistant Chief of Business Operations'),
          ('EM-1',     'Emergency Manager'),
          ('BOD-1',    'Business Operations Staff 1'),
          ('BOD-2',    'Business Operations Staff 2')
       ) AS v(id, display_name)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification — read-only.

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification — read-only. Each query returns its own result set; the Supabase
-- editor shows only the last one, so run them one at a time to read each.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Re-run the "existing" query in Step 1. Expect 34 rows once the insert has
--    run — every unit the permanent roster writes to. A missing one means those
--    assignments are silently skipped at import.

-- 2. Confirm every pinned employee ID resolves. The roster no longer matches
--    people by name; each filled post carries an ID from the personnel master.
--    Expect 34 rows.
SELECT 'employee' AS check, id, first_name, last_name, rank
  FROM employees
 WHERE id IN (
         554, 3524, 6762, 6763, 3103, 5855,   -- deputy fire marshals FM1-FM6
        7490, 7491,                           -- inspectors
        7536, 1733,  872, 3580, 9843,         -- training division (9843 = Lowry, db/004)
        7549, 2587, 7397, 7335, 7338, 7455, 6993,  -- EMS division
        5467, 7348, 7340,                     -- logistics division
        7184, 2459, 6400,                     -- Office of the Fire Chief
         919, 1120,                           -- Emergency Operations Division
        3375, 6936, 1948, 6399,               -- Business Operations Division
        2830, 7356                            -- REACH-1
       )
 ORDER BY id;

-- 3. The reverse — which pinned IDs are absent? Expect no rows. A missing ID
--    now fails its foreign key at import rather than being skipped quietly, so
--    this is the one to read carefully.
--    9843 will appear here until db/004 has been run; that is expected.
SELECT 'missing_id' AS check, v.id
  FROM (VALUES
          (554),(3524),(6762),(6763),(3103),(5855),
          (7490),(7491),
          (7536),(1733),(872),(3580),(9843),
          (7549),(2587),(7397),(7335),(7338),(7455),(6993),
          (5467),(7348),(7340),
          (7184),(2459),(6400),
          (919),(1120),
          (3375),(6936),(1948),(6399),
          (2830),(7356)
       ) AS v(id)
 WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = v.id);

-- The DC of Operations post (DC-OPS) is deliberately vacant and needs no
-- employee record.
