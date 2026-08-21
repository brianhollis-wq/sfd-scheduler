# Replacing CrewSense

The goal is for this application to become the department's system of record for
staffing — not a board that mirrors CrewSense, and not a sync against it. Every
change should move toward that or at least not move away from it.

This document exists so the target does not drift between working sessions. It
describes what is already built, what is missing, and the order the missing work
should happen in.

## What already exists

The independent path is wired end to end. It is not the path in daily use, but
it is not a sketch either:

```
shift_calendar      which shift letter (A/B/C/D) works each date
      |
shift_roster        permanent crew: employee -> apparatus -> position, per shift letter
      |
/schedule/[date]    builder seeds the day from shift_roster when no daily rows exist
      |
/api/assignments/publish
      |
daily_assignments   the day's actual roster
      |
/crew-board         the operational picture
```

The PDF importer is a second writer into `daily_assignments`, not the only one.
Both writers go through `buildDailyAssignmentRow()` and produce column-for-column
identical rows, so which one produced a day is invisible downstream. That is what
makes the cutover possible without rewriting the readers.

Also already built:

- **Seat-based minimum staffing** (`lib/schedule/staffing.ts`) — matches crew to
  seats by rank and paramedic certification, judged at a point in time, with
  service windows for peak units.
- **Overtime list bookkeeping** (`ot_list_positions`, `/callback`, `/mot`) —
  recording a callback moves the member to the bottom of the list, increments
  `times_mandatoried` and stamps `last_mandatory_date`.
- **Permanent roster** (`lib/schedule/admin-roster.ts`) — administration,
  specialty, training, EMS, logistics and REACH-1 posts that never appear in the
  PDF at all. These are already generated, not imported.
- **Debit days** (`debit_days`, `/debit-days`).

## What is missing

In the order it should be built. Each stage is useful on its own; none of it is
wasted if the timeline stretches.

### 0. One rotation, not two

`shift_rotation` and `shift_calendar` both answer "which shift letter works on
date X". The crew board reads the first; every other page reads the second. While
the PDF carries the truth this is only a cosmetic risk. Generating the schedule
makes the rotation the foundation, and a foundation cannot have two answers.

Pick one, migrate the readers, drop the other. Then populate it years forward,
Kelly days included. `db/006_replacement_readiness.sql` reports the disagreement
and how far the rotation currently runs.

### 1. Prove the roster can stand alone

Before building workflows, find out what is not yet known. Import the PDF as
usual *and* generate the same day from `shift_roster`, then diff them. Every
difference is one of three things:

- a gap in `shift_roster`,
- a scheduling rule nobody has written down,
- a real event (leave, trade, callback) with no workflow yet.

This converts "what are we missing" from guesswork into a list, and it is the
cheapest step here. Build it as a page, not a script, so it can be checked daily.

### 2. Authentication and identity

There is none today: a single Supabase client with the service-role key, no
middleware, no login. Everything runs with full admin rights.

That is acceptable for a board one person drives. It is not acceptable for a
system of record where a member requests leave or accepts a callback. This stage
is a hard prerequisite for stages 3-5 and cannot be deferred past them:

- accounts tied to `employees.id`,
- roles (member, company officer, battalion chief, administrator),
- an audit trail of who changed what and when,
- row-level security, so the service-role key stops being the only credential.

### 3. Leave requests and approval

The ten leave types already exist in the vocabulary
(`lib/schedule/assignment-types.ts`). What is missing is how a row gets that type
without the PDF: request, approve or deny, and the resulting hole appearing in
the daily roster automatically so the vacancy is visible to whoever fills it.

### 4. Trades

The PDF prints `Traded with <name>`. Needs a request, the other member's
acceptance, an approval, and an atomic swap of two people on a date.

### 5. Callback and mandatory overtime, end to end

The list ordering already works. What is missing is execution: working down the
list, recording contact attempts and responses, and writing the resulting
`callback_voluntary` or `callback_mandatory` row.

**Notification is the hardest single piece of this project.** CrewSense calls and
texts people. Replacing that means an SMS/voice provider, delivery receipts,
retries, and someone accountable when a notification does not arrive at 02:00.
Treat it as its own project, not a task.

### 6. Payroll export

`hours_scheduled` is on every row and nothing consumes it. Hours by type per pay
period, in whatever format payroll accepts.

## Rules for work along the way

1. **Never add a reader that only understands imported rows.** A generated day
   and an imported day must stay indistinguishable downstream.
2. **Keep the PDF importer.** It is the fallback and the way history is
   backfilled. Cutting over means using it less, not deleting it.
3. **Parallel-run before cutting over.** No stage goes live because it passes
   tests; it goes live because it produced the same answer as CrewSense for long
   enough to trust it.
4. **New scheduling facts belong in the database, not in the parser.** Anything
   derived from the PDF is a temporary source.

## Open decisions

These need a person, not code:

- **Does the department accept this as the official record?** Two systems of
  record with no rule for which wins is worse than one imperfect one.
- **Who is accountable when a callback notification fails?** Answer before
  stage 5 ships, not after.
- **How long is the parallel run?** Suggest a full rotation cycle at minimum, so
  every shift letter and every Kelly day is exercised.

## Known issue to fix before winter

`lib/schedule/shift-window.ts` assumes Pacific Daylight Time year-round. From
roughly November the stored UTC timestamps are one hour early. It is pre-existing
and deliberately preserved so reconciliation did not silently shift historical
data, but it needs a fix plus a backfill.
