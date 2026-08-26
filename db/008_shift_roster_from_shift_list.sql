-- ─────────────────────────────────────────────────────────────────────────────
-- 008 — Permanent shift roster, from the SFD Shift List
--
-- Run in the Supabase SQL editor. Idempotent: it replaces shift_roster
-- wholesale, so re-running converges on the same state.
--
-- Source: the department's own SFD SHIFT LIST, UPDATED 20260824. That document
-- is the authority for who is permanently assigned where, and it carries all
-- four shifts. The readiness check (db/006) found shift_roster holding 121 rows
-- against roughly 70 positions on a real day — barely half a shift, and only
-- 14-15 apparatus covered on C and D. Without it the schedule builder cannot
-- stand in for the PDF, which is what stage 1 of docs/replacing-crewsense.md
-- depends on.
--
-- Three things the shift list does not say, resolved here:
--
--   * Which rig at stations 2 and 4. Each station lists two people per rank and
--     they alternate between the engine and the truck. The list does not say
--     which, and the assignment moves day to day when someone is off — Riesterer
--     and Crofts were on ENGINE 2 on 08/19 and TRUCK 2 on 08/23 because their
--     engineer was on a trade. Taken from the most recent real day in the
--     CrewSense export where one exists; where none does, the two people at a
--     rank are split across the two rigs so neither is doubled up. Either way
--     it is a starting point the day's schedule can override.
--
--   * Station 8. Listed as DEBIT for captain and engineer on every shift, so it
--     has no permanent crew by design. Those seats are left empty rather than
--     invented, which resolves the E-8 rows db/006 reported as gaps.
--
--   * The peak medics and REACH-1. MEDIC 1 and MEDIC 9 run ALPHA/BRAVO crews on
--     day-of-week patterns (TU-W-TH-F, M-TU-W-TH), not the four-shift rotation,
--     and so does REACH 1. They belong in the permanent day roster
--     (lib/schedule/admin-roster.ts), not here. This is why db/006 reported M-1
--     and M-9 missing from every shift: they are correctly absent.
--
-- Names are resolved to employees by first and last name, falling back to
-- name_aliases. Anything unresolved is still inserted, with a null employee_id,
-- so the seat shows on the board as vacant rather than disappearing — and the
-- verification at the end names every one of them.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: the incoming roster ──────────────────────────────────────────────
DROP TABLE IF EXISTS _incoming_roster;
CREATE TEMP TABLE _incoming_roster (
  shift_letter text,
  apparatus_id text,
  position     text,
  sort_order   int,
  first_name   text,
  last_name    text,
  note         text,
  employee_id  integer
);

INSERT INTO _incoming_roster
  (shift_letter, apparatus_id, position, sort_order, first_name, last_name, note, employee_id)
VALUES
    ('A', 'BC-2', 'BC', 0, 'Allan', 'Kehrer', NULL, 4957),
    ('A', 'BC-4', 'BC', 0, 'Bob', 'Schaffer', NULL, 2844),
    ('A', 'E-1', 'Captain', 0, 'Doug', 'Stoops', 'FTO', 3112),
    ('A', 'E-2', 'Captain', 0, 'Michael', 'Patrick', NULL, 2840),
    ('A', 'TR-2', 'Captain', 0, NULL, NULL, NULL, NULL),
    ('A', 'E-3', 'Captain', 0, 'Bryan', 'Lewis', NULL, 4278),
    ('A', 'TR-4', 'Captain', 0, 'Luke', 'Barr', NULL, 3885),
    ('A', 'E-4', 'Captain', 0, 'Jared', 'Beard', NULL, 5499),
    ('A', 'E-5', 'Captain', 0, 'Andy', 'Grimmer', NULL, 2588),
    ('A', 'E-6', 'Captain', 0, 'Nick', 'VanBishler', NULL, 2133),
    ('A', 'E-7', 'Captain', 0, 'Billy', 'Anderson', 'FTO', 2831),
    ('A', 'E-9', 'Captain', 0, 'James', 'Gunia', NULL, 2308),
    ('A', 'E-10', 'Captain', 0, 'Sean', 'Breitbach', NULL, 2137),
    ('A', 'E-11', 'Captain', 0, 'Jeff', 'Zaluskey', NULL, 809),
    ('A', 'E-1', 'ENG_P', 11, 'TJ', 'Greenhill', NULL, 5836),
    ('A', 'E-2', 'ENG_P', 11, 'Cody', 'Welling', NULL, 5142),
    ('A', 'E-2', 'ENG_P', 12, 'Michael', 'Laatsch', NULL, 5937),
    ('A', 'E-3', 'ENG_P', 11, NULL, NULL, NULL, NULL),
    ('A', 'E-4', 'ENG_P', 11, 'Brian', 'Cole', NULL, 5501),
    ('A', 'TR-4', 'ENG_P', 11, 'Jeffrey', 'Whitworth', NULL, 6238),
    ('A', 'E-5', 'ENG_P', 11, 'Cody', 'Miller', NULL, 5505),
    ('A', 'E-6', 'ENG_P', 11, 'Loren', 'Rudkin', NULL, 2592),
    ('A', 'E-7', 'ENG_P', 11, 'Cory', 'Cochran', 'LTD', 3104),
    ('A', 'E-9', 'ENG_P', 11, 'Dru', 'Davis', NULL, 4404),
    ('A', 'E-10', 'ENG_P', 11, 'Taylor', 'Russell', NULL, 6369),
    ('A', 'E-11', 'ENG_P', 11, 'Ryan', 'Bielenberg', NULL, 5929),
    ('A', 'E-1', 'FF_PM', 22, 'Steven', 'Weaver', NULL, 6849),
    ('A', 'E-2', 'FF_PM', 23, 'Alex', 'Donahue', NULL, 6498),
    ('A', 'TR-2', 'FF_PM', 21, 'Gerardo', 'Oliveros', NULL, 6235),
    ('A', 'E-3', 'FF_PM', 22, 'David', 'Olvera-Godinez', NULL, 6606),
    ('A', 'TR-4', 'FF_PM', 22, 'Riley', 'Walker', NULL, 7063),
    ('A', 'TR-4', 'FF_PM', 23, 'Jared', 'Haag', NULL, 5332),
    ('A', 'E-5', 'FF_PM', 22, 'Jamin', 'Hooley', NULL, 7060),
    ('A', 'E-6', 'FF_PM', 22, 'Wesley', 'Strawn', NULL, 6371),
    ('A', 'E-7', 'FF_PM', 22, 'John', 'Beaudoin', NULL, 6365),
    ('A', 'E-8', 'FF_PM', 20, 'Nathan', 'Brown', 'LTD', 5835),
    ('A', 'E-9', 'FF_PM', 22, NULL, NULL, NULL, NULL),
    ('A', 'E-10', 'FF_PM', 22, 'Morgan', 'Burch', NULL, 6603),
    ('A', 'E-11', 'FF_PM', 22, 'Michael', 'Hasson', NULL, 5595),
    ('A', 'M-2', 'SRP', 0, 'Hannah', 'Johnson', NULL, 7262),
    ('A', 'M-2', 'SRE', 11, 'Martin', 'Curiel', NULL, 7103),
    ('A', 'M-3', 'SRP', 0, 'Arianna', 'Grant', NULL, 7355),
    ('A', 'M-3', 'SRE', 11, 'Christopher', 'Oakland', NULL, NULL),
    ('A', 'M-4', 'SRP', 0, 'Sean', 'Kelley', NULL, 7291),
    ('A', 'M-4', 'SRE', 11, 'Carson', 'Piesker', NULL, NULL),
    ('A', 'M-5', 'SRP', 0, NULL, NULL, NULL, NULL),
    ('A', 'M-5', 'SRE', 11, NULL, NULL, NULL, NULL),
    ('A', 'M-7', 'SRP', 0, 'Anthony', 'Martinez', NULL, 7487),
    ('A', 'M-7', 'SRE', 11, 'Adam', 'Shahan', NULL, 7577),
    ('A', 'M-10', 'SRP', 0, 'Olivia', 'Squires-Moody', NULL, 7325),
    ('A', 'M-10', 'SRE', 11, 'Inderpreet', 'Bains', NULL, 7353),
    ('B', 'BC-2', 'BC', 0, 'Brad', 'Paris', NULL, 2136),
    ('B', 'BC-4', 'BC', 0, 'Frank', 'Stephenson', NULL, 194),
    ('B', 'E-1', 'Captain', 0, 'Jason', 'Armstrong', 'FTO', 730),
    ('B', 'TR-2', 'Captain', 0, 'William', 'O''Connell', NULL, 4961),
    ('B', 'E-2', 'Captain', 0, 'Andrew', 'Lake', 'LTD', 4277),
    ('B', 'E-3', 'Captain', 0, 'Dylan', 'Harvey', NULL, 4956),
    ('B', 'TR-4', 'Captain', 0, 'Nick', 'Bradley', NULL, 5138),
    ('B', 'E-4', 'Captain', 0, 'Blair', 'Grimmer', NULL, 3106),
    ('B', 'E-5', 'Captain', 0, 'David', 'Brown', NULL, 2832),
    ('B', 'E-6', 'Captain', 0, 'Gary', 'West', NULL, 1591),
    ('B', 'E-7', 'Captain', 0, 'Adam', 'Hoffman', NULL, 1621),
    ('B', 'E-9', 'Captain', 0, 'Brian', 'Hollis', NULL, 3107),
    ('B', 'E-10', 'Captain', 0, 'Nathan', 'Ohrt', NULL, 2839),
    ('B', 'E-11', 'Captain', 0, 'Michael', 'Stewart', NULL, 2595),
    ('B', 'E-1', 'ENG_P', 11, 'Kurtis', 'Den', NULL, 2836),
    ('B', 'E-2', 'ENG_P', 11, NULL, NULL, NULL, NULL),
    ('B', 'TR-2', 'ENG_P', 11, 'Jeff', 'Bell', NULL, 3575),
    ('B', 'E-3', 'ENG_P', 11, 'Zachary', 'Hanna', NULL, 5932),
    ('B', 'TR-4', 'ENG_P', 11, 'Christopher', 'Taylor', NULL, 4120),
    ('B', 'E-4', 'ENG_P', 11, 'Tyler', 'Bullock', NULL, 6230),
    ('B', 'E-5', 'ENG_P', 11, 'Dustin', 'Labrousse', NULL, 4958),
    ('B', 'E-6', 'ENG_P', 11, 'Tim', 'Clark', NULL, 2442),
    ('B', 'E-7', 'ENG_P', 11, 'Zachary', 'Salvage', NULL, 5508),
    ('B', 'E-9', 'ENG_P', 11, 'Jarret', 'Lundborg', NULL, 2838),
    ('B', 'E-10', 'ENG_P', 11, 'Ronnie', 'Williams', NULL, 4412),
    ('B', 'E-11', 'ENG_P', 11, 'Rob', 'Mengucci', 'LTD', 2312),
    ('B', 'E-1', 'FF_PM', 22, NULL, NULL, NULL, NULL),
    ('B', 'TR-2', 'FF_PM', 22, 'Grant', 'Hadley', NULL, 6793),
    ('B', 'TR-2', 'FF_PM', 23, 'Nicholas', 'Sines', NULL, 6613),
    ('B', 'E-3', 'FF_PM', 22, NULL, NULL, NULL, NULL),
    ('B', 'E-4', 'FF_PM', 22, 'Bryce', 'Glovatsky', NULL, 5139),
    ('B', 'E-4', 'FF_PM', 23, 'Phil', 'Hyatt', NULL, 5833),
    ('B', 'E-5', 'FF_PM', 22, 'Danny', 'South', NULL, 5940),
    ('B', 'E-6', 'FF_PM', 22, 'Jack', 'Westerman', NULL, 5942),
    ('B', 'E-7', 'FF_PM', 22, 'Sarah', 'Merrick', NULL, 3891),
    ('B', 'E-8', 'FF_PM', 20, 'Matthew', 'Shore', NULL, 4963),
    ('B', 'E-9', 'FF_PM', 22, NULL, NULL, NULL, NULL),
    ('B', 'E-10', 'FF_PM', 22, 'Brandon', 'Hansen', NULL, 5933),
    ('B', 'E-11', 'FF_PM', 22, 'Dylan', 'Kidd', NULL, 7057),
    ('B', 'M-2', 'SRP', 0, 'Michael', 'Fuchs', NULL, 7458),
    ('B', 'M-2', 'SRE', 11, 'Andrew', 'Myers', NULL, 7254),
    ('B', 'M-3', 'SRP', 0, 'Kelsey', 'Altmayer', NULL, 7485),
    ('B', 'M-3', 'SRE', 11, 'Christian', 'Jacobsen', NULL, 7352),
    ('B', 'M-4', 'SRP', 0, 'Isaac', 'Helt', NULL, 7278),
    ('B', 'M-4', 'SRE', 11, 'Iris', 'Hernandez-Gutierrez', NULL, NULL),
    ('B', 'M-5', 'SRP', 0, NULL, NULL, NULL, NULL),
    ('B', 'M-5', 'SRE', 11, NULL, NULL, NULL, NULL),
    ('B', 'M-7', 'SRP', 0, 'Branden', 'Haddock', NULL, 7283),
    ('B', 'M-7', 'SRE', 11, 'Abigail', 'Hulett', NULL, 7282),
    ('B', 'M-10', 'SRP', 0, 'Julio', 'Morales-Alvarado', NULL, 7328),
    ('B', 'M-10', 'SRE', 11, 'Kennedy', 'Brouhard', NULL, 7308),
    ('C', 'BC-2', 'BC', 0, 'Nick', 'Grice', NULL, 2006),
    ('C', 'BC-4', 'BC', 0, 'Ty', 'Gunesch', NULL, 1187),
    ('C', 'E-1', 'Captain', 0, 'Luis', 'Matheus', 'FTO', 5504),
    ('C', 'E-2', 'Captain', 0, 'Justin', 'Gregory', NULL, 5140),
    ('C', 'TR-2', 'Captain', 0, 'Brian', 'Mitzel', 'FTO', 2313),
    ('C', 'E-2', 'Captain', 1, 'Taylor', 'Jacobberger', 'FTO', 5596),
    ('C', 'E-3', 'Captain', 0, 'Nicklaus', 'Williams', NULL, 5339),
    ('C', 'TR-4', 'Captain', 0, 'Jeremy', 'Salvage', NULL, 2843),
    ('C', 'E-4', 'Captain', 0, NULL, NULL, NULL, NULL),
    ('C', 'E-5', 'Captain', 0, 'Ryan', 'Ross', NULL, 2842),
    ('C', 'E-6', 'Captain', 0, 'Brandon', 'Hoff', NULL, 4276),
    ('C', 'E-7', 'Captain', 0, 'Eric', 'Creech', NULL, 3105),
    ('C', 'E-10', 'Captain', 0, 'Rich', 'Lee', NULL, 2005),
    ('C', 'E-11', 'Captain', 0, 'Willy', 'Giddings', NULL, 2307),
    ('C', 'E-1', 'ENG_P', 11, NULL, NULL, NULL, NULL),
    ('C', 'TR-2', 'ENG_P', 11, 'Brent', 'Stepman', NULL, 4965),
    ('C', 'E-2', 'ENG_P', 12, 'Matthew', 'Fimbres', NULL, 5594),
    ('C', 'E-3', 'ENG_P', 11, 'Bryan', 'Sanchez Lopez', NULL, 6368),
    ('C', 'TR-4', 'ENG_P', 11, 'Wyatt', 'Davis', NULL, 6497),
    ('C', 'E-4', 'ENG_P', 11, 'Tyler', 'Hordichok', NULL, 4408),
    ('C', 'E-5', 'ENG_P', 11, 'Kyle', 'Brown', NULL, 6372),
    ('C', 'E-6', 'ENG_P', 11, 'Dmitriy', 'Zubov', NULL, 5511),
    ('C', 'E-7', 'ENG_P', 11, 'Bobby', 'LaMar', NULL, 2311),
    ('C', 'E-9', 'ENG_P', 10, 'Michael', 'Harlan', NULL, 5333),
    ('C', 'E-10', 'ENG_P', 11, 'Jerry', 'Hochderffer', NULL, 2310),
    ('C', 'E-11', 'ENG_P', 11, 'Steven', 'Ferrier', NULL, 3377),
    ('C', 'E-1', 'FF_PM', 22, 'Justin', 'Ostrowski', NULL, 7061),
    ('C', 'TR-2', 'FF_PM', 22, 'Andrew', 'Ketelson', NULL, 6233),
    ('C', 'E-2', 'FF_PM', 23, NULL, NULL, NULL, NULL),
    ('C', 'E-3', 'FF_PM', 22, 'Brad', 'Mabie', NULL, 6848),
    ('C', 'E-4', 'FF_PM', 22, 'Andrew', 'Snodgrass', NULL, 6790),
    ('C', 'E-4', 'FF_PM', 23, 'Brandon', 'Johnson', NULL, 5934),
    ('C', 'E-5', 'FF_PM', 22, 'Zachery', 'Gescher', NULL, 6602),
    ('C', 'E-6', 'FF_PM', 22, 'Lucas', 'Rathburn', NULL, 5141),
    ('C', 'E-7', 'FF_PM', 22, 'Grayson', 'Engels-Smith', NULL, 6367),
    ('C', 'E-8', 'FF_PM', 20, 'Richard', 'McKee', NULL, 6615),
    ('C', 'E-9', 'FF_PM', 21, NULL, NULL, NULL, NULL),
    ('C', 'E-10', 'FF_PM', 22, 'Kyle', 'Holestine', NULL, 5502),
    ('C', 'E-11', 'FF_PM', 22, 'Christopher', 'Frank', NULL, 6846),
    ('C', 'M-2', 'SRP', 0, 'Nicholas', 'Welk', NULL, 7576),
    ('C', 'M-2', 'SRE', 11, 'Lexie', 'McKinley', NULL, 7253),
    ('C', 'M-3', 'SRP', 0, NULL, NULL, NULL, NULL),
    ('C', 'M-3', 'SRE', 11, 'Emily', 'Kirk', NULL, 7354),
    ('C', 'M-4', 'SRP', 0, 'David', 'Ross', NULL, 7266),
    ('C', 'M-4', 'SRE', 11, 'Isabella', 'Freitas', NULL, 7256),
    ('C', 'M-5', 'SRP', 0, NULL, NULL, NULL, NULL),
    ('C', 'M-5', 'SRE', 11, NULL, NULL, NULL, NULL),
    ('C', 'M-7', 'SRP', 0, 'Heather', 'McHugh', NULL, 7337),
    ('C', 'M-7', 'SRE', 11, 'Conor', 'Gorospe', NULL, 7314),
    ('C', 'M-7', 'SRE', 12, 'Justin', 'Bishop', NULL, 7310),
    ('C', 'M-10', 'SRP', 0, 'Theresa', 'Murphy', NULL, 7324),
    ('C', 'M-10', 'SRE', 11, 'Karis', 'Chapin', NULL, 7257),
    ('D', 'BC-2', 'BC', 0, 'Matt', 'Brozovich', NULL, 2615),
    ('D', 'BC-4', 'BC', 0, 'Shawn', 'Barnes', NULL, 639),
    ('D', 'E-1', 'Captain', 0, 'Trevor', 'Fosmark', 'FTO', 2306),
    ('D', 'TR-2', 'Captain', 0, 'Adam', 'Burt', NULL, 2833),
    ('D', 'E-2', 'Captain', 0, 'Jeremy', 'Tinney', NULL, 2317),
    ('D', 'E-3', 'Captain', 0, 'Michael', 'Pacheco', NULL, 5506),
    ('D', 'E-4', 'Captain', 0, 'Silas', 'Ohlgren', 'FTO', 4118),
    ('D', 'TR-4', 'Captain', 0, 'Mark', 'Hansen', NULL, 3890),
    ('D', 'E-5', 'Captain', 0, 'Josh', 'Hiskey', NULL, 3578),
    ('D', 'E-6', 'Captain', 0, NULL, NULL, NULL, NULL),
    ('D', 'E-7', 'Captain', 0, 'Pat', 'Shaw', 'FTO', 936),
    ('D', 'E-9', 'Captain', 0, 'Jason', 'Robbins', 'LTD', 2841),
    ('D', 'E-10', 'Captain', 0, 'Daniel', 'Steffen', NULL, 4964),
    ('D', 'E-11', 'Captain', 0, 'Brandon', 'Silence', NULL, 3892),
    ('D', 'E-1', 'ENG_P', 11, 'Chris', 'Paulsen', NULL, 5507),
    ('D', 'TR-2', 'ENG_P', 11, 'Colby', 'Riesterer', NULL, 5597),
    ('D', 'E-2', 'ENG_P', 11, 'Chuck', 'Ettel', NULL, 989),
    ('D', 'E-3', 'ENG_P', 11, 'Tim', 'Pope', NULL, 5337),
    ('D', 'E-4', 'ENG_P', 11, 'Victor', 'Hess', NULL, 6366),
    ('D', 'TR-4', 'ENG_P', 11, 'Dustin', 'Baum', NULL, 5512),
    ('D', 'E-5', 'ENG_P', 11, 'Peter', 'Desmarteau', NULL, 4955),
    ('D', 'E-6', 'ENG_P', 11, 'Nick', 'Ottele', NULL, 2591),
    ('D', 'E-7', 'ENG_P', 11, 'Mike', 'Hoopes', NULL, 4407),
    ('D', 'E-9', 'ENG_P', 11, 'Cole', 'Clarke', NULL, 4274),
    ('D', 'E-10', 'ENG_P', 11, 'Andrew', 'Monsrud', NULL, 5938),
    ('D', 'E-11', 'ENG_P', 11, 'Nicholas', 'Coleman', NULL, 6496),
    ('D', 'E-1', 'FF_PM', 22, 'Jacob', 'Sessa', NULL, 6792),
    ('D', 'TR-2', 'FF_PM', 22, 'Wyatt', 'Crofts', NULL, 5930),
    ('D', 'E-2', 'FF_PM', 22, 'Andrew', 'Erwert', NULL, 6605),
    ('D', 'E-3', 'FF_PM', 22, 'Eric', 'Nelson', NULL, 5335),
    ('D', 'E-4', 'FF_PM', 22, 'Holden', 'Partain', NULL, 6499),
    ('D', 'TR-4', 'FF_PM', 22, 'Sean', 'Wilson', NULL, 6607),
    ('D', 'E-5', 'FF_PM', 22, 'Mike', 'McIntosh', NULL, 7059),
    ('D', 'E-6', 'FF_PM', 22, 'Tyler', 'Mendel', NULL, 4960),
    ('D', 'E-7', 'FF_PM', 22, 'Desiree', 'Barringer', NULL, 6791),
    ('D', 'E-8', 'FF_PM', 20, NULL, NULL, NULL, NULL),
    ('D', 'E-9', 'FF_PM', 22, 'Joey', 'Weigand', NULL, 4966),
    ('D', 'E-10', 'FF_PM', 22, 'Jackson', 'Mehl', NULL, 7062),
    ('D', 'E-11', 'FF_PM', 22, 'Jordan', 'Fanning', NULL, 7056),
    ('D', 'M-2', 'SRP', 0, 'Matthew', 'Noller', NULL, 7290),
    ('D', 'M-2', 'SRE', 11, 'Jamie', 'Erway', NULL, 7313),
    ('D', 'M-2', 'SRE', 12, 'Austin', 'Alexander', NULL, 7255),
    ('D', 'M-3', 'SRP', 0, 'Amber', 'DeMaris', NULL, 7312),
    ('D', 'M-3', 'SRE', 11, 'Brenden', 'Nipp', NULL, 7311),
    ('D', 'M-4', 'SRP', 0, 'Kyle', 'Ulshafer', 'ME', 7267),
    ('D', 'M-4', 'SRP', 1, 'Alexis', 'Williams', NULL, 7563),
    ('D', 'M-4', 'SRE', 12, NULL, NULL, NULL, NULL),
    ('D', 'M-5', 'SRP', 0, NULL, NULL, NULL, NULL),
    ('D', 'M-5', 'SRE', 11, NULL, NULL, NULL, NULL),
    ('D', 'M-7', 'SRP', 0, 'Heather', 'Matlock', NULL, 7260),
    ('D', 'M-7', 'SRE', 11, 'Vincent', 'Cravinho', NULL, 7578),
    ('D', 'M-10', 'SRP', 0, 'Nicholas', 'Duncan', NULL, 7326),
    ('D', 'M-10', 'SRE', 11, 'Dawson', 'Burris', NULL, 7309);

-- ── Step 2: resolve people ───────────────────────────────────────────────────
-- The ids above were resolved against the personnel master by name, including
-- its go-by names. Verify each one still points at the person the shift list
-- names; a reused or stale id is nulled here rather than seating the wrong
-- member on an apparatus.
UPDATE _incoming_roster r
   SET employee_id = NULL
 WHERE r.employee_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM employees e
      WHERE e.id = r.employee_id
        -- Hyphen and space are the same separator in a compound surname:
        -- the shift list writes Morales-Alvarado, the personnel master writes
        -- Morales Alvarado. Comparing them literally would reject the very
        -- match that resolved the id.
        AND regexp_replace(lower(e.last_name), '[\s-]+', ' ', 'g')
          = regexp_replace(lower(r.last_name), '[\s-]+', ' ', 'g'));

-- Anything the master could not resolve gets a second chance against the
-- database, which carries more people than the master export does.
UPDATE _incoming_roster r
   SET employee_id = e.id
  FROM employees e
 WHERE r.employee_id IS NULL
   AND r.first_name IS NOT NULL
   AND lower(e.first_name) = lower(r.first_name)
   AND lower(e.last_name)  = lower(r.last_name);

-- Fall back to the alias table for the go-by names the schedule uses.
UPDATE _incoming_roster r
   SET employee_id = a.employee_id
  FROM name_aliases a
 WHERE r.employee_id IS NULL
   AND r.first_name IS NOT NULL
   AND lower(a.alias) = lower(r.first_name || ' ' || r.last_name);

-- And for a surname the list writes in full where the department shortens it,
-- or the reverse — the mirror of the rule in lib/employees/find.ts.
UPDATE _incoming_roster r
   SET employee_id = e.id
  FROM employees e
 WHERE r.employee_id IS NULL
   AND r.first_name IS NOT NULL
   AND lower(e.first_name) = lower(r.first_name)
   AND (lower(e.last_name) LIKE lower(r.last_name) || '-%'
     OR lower(r.last_name) LIKE lower(e.last_name) || '-%');

-- ── Step 3: replace shift_roster ─────────────────────────────────────────────
-- Built from information_schema because shift_roster.id may or may not carry a
-- default: supplying an explicit value fails against a GENERATED ALWAYS
-- identity, and omitting it fails against a plain integer primary key. db/004
-- failed three times on exactly this class of assumption.
DO $$
DECLARE
  -- Prefixed because is_identity is also a column of information_schema.columns
  -- and PL/pgSQL rejects the reference as ambiguous rather than picking one.
  v_has_default boolean;
  v_is_identity boolean;
BEGIN
  SELECT (c.column_default IS NOT NULL), (c.is_identity = 'YES')
    INTO v_has_default, v_is_identity
    FROM information_schema.columns c
   WHERE c.table_schema = current_schema()
     AND c.table_name = 'shift_roster'
     AND c.column_name = 'id';

  DELETE FROM shift_roster;

  IF COALESCE(v_has_default, false) OR COALESCE(v_is_identity, false) THEN
    INSERT INTO shift_roster (apparatus_id, shift_letter, position, sort_order, note, employee_id)
    SELECT apparatus_id, shift_letter, position, sort_order, note, employee_id
      FROM _incoming_roster;
  ELSE
    INSERT INTO shift_roster (id, apparatus_id, shift_letter, position, sort_order, note, employee_id)
    SELECT row_number() OVER (ORDER BY shift_letter, apparatus_id, sort_order),
           apparatus_id, shift_letter, position, sort_order, note, employee_id
      FROM _incoming_roster;
  END IF;
END $$;

-- ── Step 4: verify ───────────────────────────────────────────────────────────
-- One result set, because the SQL editor shows only the last statement.
SELECT ord, "check", item, detail FROM (

  -- A UNION takes its column names from the first branch, so this one has to
  -- alias all four or the outer query has no `detail` to select.
  SELECT 10 AS ord, 'total' AS "check", 'shift_roster' AS item,
         COUNT(*)::text || ' rows, ' || COUNT(employee_id)::text || ' linked to a person' AS detail
    FROM shift_roster

  UNION ALL
  SELECT 20, 'by_shift', btrim(shift_letter::text),
         COUNT(*)::text || ' positions, ' ||
         COUNT(employee_id)::text || ' filled, ' ||
         (COUNT(*) - COUNT(employee_id))::text || ' open, ' ||
         COUNT(DISTINCT apparatus_id)::text || ' apparatus'
    FROM shift_roster GROUP BY btrim(shift_letter::text)

  -- Anyone the list names that no employee record matched. Expect none; each
  -- one is a seat that will read vacant until the name is reconciled.
  UNION ALL
  SELECT 30, 'unresolved_name',
         btrim(r.shift_letter::text) || ' ' || r.apparatus_id || ' ' || r.position,
         r.first_name || ' ' || r.last_name
    FROM _incoming_roster r
   WHERE r.employee_id IS NULL AND r.first_name IS NOT NULL

  -- Seats the list itself shows as vacant. These are real openings.
  UNION ALL
  SELECT 40, 'vacant_on_the_list', btrim(shift_letter::text) || ' ' || apparatus_id,
         position || ' — no name on the shift list'
    FROM shift_roster WHERE employee_id IS NULL

  -- A roster row pointing at an apparatus that does not exist.
  UNION ALL
  SELECT 50, 'unknown_apparatus', r.apparatus_id, COUNT(*)::text || ' rows'
    FROM shift_roster r
   WHERE NOT EXISTS (SELECT 1 FROM apparatus a WHERE a.id = r.apparatus_id)
   GROUP BY r.apparatus_id

  -- Nobody should hold two seats on the same shift.
  UNION ALL
  SELECT 60, 'double_booked',
         btrim(r.shift_letter::text) || ' emp ' || r.employee_id::text,
         string_agg(r.apparatus_id, ', ' ORDER BY r.apparatus_id)
    FROM shift_roster r
   WHERE r.employee_id IS NOT NULL
   GROUP BY btrim(r.shift_letter::text), r.employee_id
  HAVING COUNT(*) > 1

  -- Units carrying fewer seats than their own minimum. Compared against
  -- apparatus.min_staffing rather than a flat number, so a battalion chief's
  -- single seat and E-8's lone firefighter — both correct — stay quiet and
  -- only real shortfalls show.
  UNION ALL
  SELECT 70, 'under_min_staffing',
         btrim(r.shift_letter::text) || ' ' || r.apparatus_id,
         COUNT(*)::text || ' seats rostered, minimum is ' || MAX(a.min_staffing)::text
    FROM shift_roster r
    JOIN apparatus a ON a.id = r.apparatus_id
   GROUP BY btrim(r.shift_letter::text), r.apparatus_id
  HAVING COUNT(*) < MAX(a.min_staffing)

) t ORDER BY ord, item;
