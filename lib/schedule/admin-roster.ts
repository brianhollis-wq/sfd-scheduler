/**
 * Permanent roster — people whose assignment never appears in the daily PDF.
 *
 * The daily schedule PDF covers line personnel. Administration and specialty
 * staff work fixed weekday schedules and do not appear in it at all, so they
 * are expanded from this table whenever a day is committed.
 *
 * Employee IDs are pinned from the personnel master list rather than resolved
 * by name — see the employeeId field below for why.
 *
 * REACH-1 is different: it DOES print in the PDF. It only looked absent
 * because the parser could not map the "REACH 1" heading and discarded the
 * block. Its entries stay here as a fallback for a day the PDF omits it, and
 * the overlap guard in app/import/actions.ts keeps them from doubling up when
 * the PDF does carry it.
 *
 * ON-CALL IS NOT HERE. The DFM after-hours rotation (1700–0800 weekdays,
 * 0800–0800 weekends) does appear in the PDF, under an "ON Call DFM" section
 * that lib/parse-schedule.ts already resolves per-employee from the (FM-N) call
 * sign. This table is daytime assignments only; adding call here would
 * double-book whoever the PDF already named.
 */

import { rangeShiftWindow, type ShiftWindow } from './shift-window'

/** Day-of-week codes, 0 = Sunday. */
export const MON_FRI  = [1, 2, 3, 4, 5] as const
export const MON_THU  = [1, 2, 3, 4] as const
export const TUE_FRI  = [2, 3, 4, 5] as const

export interface PermanentRosterEntry {
  /** daily_assignments.apparatus_id */
  apparatusId: string
  /** Seat label written to daily_assignments.position. */
  position: string
  /** Resolved against the employees table by name at commit time. */
  firstName: string
  lastName: string
  /**
   * Pinned employee ID, taken from the personnel master list.
   *
   * Every filled post carries one. Name resolution is only a fallback for an
   * entry added without an ID, and it is the weaker option here: the master
   * list records people by the name they go by rather than their formal one
   * (Mike Walker, Steve Boughey), and two unrelated Millers hold training
   * posts, so matching on a name written from an org chart can miss or land on
   * the wrong person. findEmployee's nickname table only expands a nickname
   * into a formal name, never the reverse.
   */
  employeeId?: number
  /**
   * A post that exists but is currently unfilled. Written as an open vacancy
   * (employee_id null) and never name-resolved, so it shows on the board as a
   * real post rather than disappearing.
   */
  vacant?: boolean
  /**
   * Radio call sign, where the post has one. Shown on the board in place of
   * the internal unit ID, which is a database key and not what anyone on the
   * floor calls this person.
   */
  callSign?: string
  /** Days worked, 0 = Sunday. */
  days: readonly number[]
  /** Local start/end clock times, 24h. Pacific, per shift-window.ts. */
  start: [number, number]
  end: [number, number]
}

// ── The roster ────────────────────────────────────────────────────────────────

export const PERMANENT_ROSTER: readonly PermanentRosterEntry[] = [
  // ── Community Risk Reduction — deputy fire marshals, weekdays 0800–1700 ────
  // The zone numbers beside each name on the CRR roster (e.g. "Roth (FM2) - 5,
  // 11") are the districts they cover, not a schedule.
  { apparatusId: 'DFM-1', position: 'Fire Marshal', callSign: 'FM1', firstName: 'Sean',   lastName: 'Mansfield', employeeId: 554, days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'DFM-2', position: 'DFM',          callSign: 'FM2', firstName: 'Sara',   lastName: 'Roth',      employeeId: 3524, days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'DFM-3', position: 'DFM',          callSign: 'FM3', firstName: 'Justin', lastName: 'Guinan',    employeeId: 6762, days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'DFM-4', position: 'DFM',          callSign: 'FM4', firstName: 'Jordan', lastName: 'Wakem',     employeeId: 6763, days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'DFM-5', position: 'DFM',          callSign: 'FM5', firstName: 'Janet',  lastName: 'Campbell',  employeeId: 3103, days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'DFM-6', position: 'DFM',          callSign: 'FM6', firstName: 'Robert', lastName: 'Johnson',   employeeId: 5855, days: MON_FRI, start: [8, 0], end: [17, 0] },

  // Inspectors — weekdays 0800–1700, no after-hours call rotation.
  { apparatusId: 'INSP-1', position: 'Inspector I', firstName: 'Diego',  lastName: 'Legorreta', employeeId: 7490, days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'INSP-2', position: 'Inspector I', firstName: 'Arthur', lastName: 'Zhiryada',  employeeId: 7491, days: MON_FRI, start: [8, 0], end: [17, 0] },

  // ── Training division ─────────────────────────────────────────────────────
  { apparatusId: 'TR-DC',   position: 'DC Training', callSign: 'C6', firstName: 'Mike', lastName: 'Walker',      employeeId: 7536, days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'TR-CPT1', position: 'Training Officer', callSign: 'TO2', firstName: 'Scott',   lastName: 'Miller',      employeeId: 1733, days: MON_THU, start: [7, 0], end: [17, 0] },
  { apparatusId: 'TR-CPT2', position: 'Training Officer', callSign: 'TO3', firstName: 'Paul',    lastName: 'Bridgehouse', employeeId: 872, days: MON_THU, start: [7, 0], end: [17, 0] },
  { apparatusId: 'TR-AO',   position: 'Training Officer', callSign: 'TO4', firstName: 'Matthew', lastName: 'Miller',      employeeId: 3580, days: TUE_FRI, start: [7, 0], end: [17, 0] },
  // Peggy Lowry is a volunteer with no payroll ID. She is identified as
  // VSA-C6, which is carried as her call sign and badge number — it cannot be
  // her employees.id, because daily_assignments.employee_id is an integer
  // foreign key into that column and will not hold a string. She therefore has
  // a numeric key, 9843, created by db/004, which must be run before she will
  // appear.
  { apparatusId: 'TR-SA',   position: 'Staff',       callSign: 'VSA-C6', firstName: 'Peggy',   lastName: 'Lowry',       employeeId: 9843, days: MON_FRI, start: [8, 0], end: [17, 0] },

  // ── EMS division ──────────────────────────────────────────────────────────
  { apparatusId: 'EMS-DC',    position: 'DC EMS',          callSign: 'C5', firstName: 'Steve', lastName: 'Boughey', employeeId: 7549, days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'EMS-COORD', position: 'EMS Coordinator', callSign: 'EMS1', firstName: 'Darrin',  lastName: 'George',  employeeId: 2587, days: MON_THU, start: [7, 0], end: [17, 0] },
  { apparatusId: 'EMS-TRN',   position: 'EMS Trainer',     callSign: 'EMS2', firstName: 'Katie',   lastName: 'Cardona', employeeId: 7397, days: MON_THU, start: [7, 0], end: [17, 0] },
  { apparatusId: 'EMS-PDA1',  position: 'Paramedic Data Analyst', firstName: 'Sam',    lastName: 'Ruck',       employeeId: 7335, days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'EMS-PDA2',  position: 'Paramedic Data Analyst', firstName: 'Emily',  lastName: 'Rodriguez',  employeeId: 7338, days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'EMS-BILL',  position: 'Billing Specialist',     firstName: 'Briley', lastName: 'Davis',      employeeId: 7455, days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'EMS-SA',    position: 'Staff Assistant',        firstName: 'Kelly',  lastName: 'Richardson', employeeId: 6993, days: MON_FRI, start: [8, 0], end: [17, 0] },

  // ── Logistics division ────────────────────────────────────────────────────
  // Kelsey Hutchinson is no relation to Joe Hutchinson on EM-1, and Amanda
  // Martinez is not Amanda Palmer on REACH-1 — both pairs are pinned by ID.
  { apparatusId: 'LOG-ANL', position: 'Logistics Mgmt Analyst', firstName: 'Kelsey', lastName: 'Hutchinson', employeeId: 5467, days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'LOG-FB',  position: 'Fire Buyer',             firstName: 'Amanda', lastName: 'Martinez',   employeeId: 7348, days: MON_THU, start: [7, 0], end: [17, 0] },
  { apparatusId: 'LOG-EB',  position: 'EMS Buyer',              firstName: 'Matt',   lastName: 'Kinney',     employeeId: 7340, days: TUE_FRI, start: [7, 0], end: [17, 0] },

  // ── Administration — all weekdays 0800–1700 ───────────────────────────────
  // Office of the Fire Chief
  { apparatusId: 'C-1',   position: 'Fire Chief', callSign: 'C1', firstName: 'David', lastName: 'Gerboth',  employeeId: 7184, days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'FCO-1', position: 'Staff',      firstName: 'Gina',  lastName: 'Cepeda',   employeeId: 2459, days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'FCO-2', position: 'Staff',      firstName: 'Dora',  lastName: 'Cardenas', employeeId: 6400, days: MON_FRI, start: [8, 0], end: [17, 0] },

  // Emergency Operations Division
  { apparatusId: 'C-2',    position: 'AC Operations',      callSign: 'C2', firstName: 'Tige', lastName: 'Harmon',     employeeId: 919, days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'DC-OPS', position: 'DC Operations',      firstName: '',     lastName: '',           days: MON_FRI, start: [8, 0], end: [17, 0], vacant: true },
  { apparatusId: 'C-4',    position: 'DC Special Projects', callSign: 'C4', firstName: 'Cord', lastName: 'Von Derahe', employeeId: 1120, days: MON_FRI, start: [8, 0], end: [17, 0] },

  // Business Operations Division
  { apparatusId: 'C-3',   position: 'AC Business Operations', callSign: 'C3', firstName: 'Brian', lastName: 'Carrara',    employeeId: 3375, days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'EM-1',  position: 'Emergency Manager',      callSign: 'EM1', firstName: 'Joe',   lastName: 'Hutchinson', employeeId: 6936, days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'BOD-1', position: 'Staff',                  firstName: 'Dean',  lastName: 'Chambers',   employeeId: 1948, days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'BOD-2', position: 'Staff',                  firstName: 'Kelli', lastName: 'Knowles',    employeeId: 6399, days: MON_FRI, start: [8, 0], end: [17, 0] },

  // ── REACH-1 — in service Tue–Fri 0800–1800 only ───────────────────────────
  // Scott Alt (FF/Paramedic) and Amanda Palmer (SRE) are the only people who
  // work REACH-1. Anyone else on it is a fill-in covering an absence, and a
  // fill-in comes from the PDF or is entered in the builder — see the
  // double-booking guard in app/import/actions.ts.
  //
  // Employee IDs were pinned here before this table existed; kept pinned
  // rather than re-resolved by name.
  { apparatusId: 'REACH-1', position: 'FF_PM', firstName: 'Scott',  lastName: 'Alt',    employeeId: 2830, days: TUE_FRI, start: [8, 0], end: [18, 0] },
  { apparatusId: 'REACH-1', position: 'SRE',   firstName: 'Amanda', lastName: 'Palmer', employeeId: 7356, days: TUE_FRI, start: [8, 0], end: [18, 0] },
]

// ── Lookups ───────────────────────────────────────────────────────────────────

/**
 * Day of week for a YYYY-MM-DD string, 0 = Sunday.
 * Read at noon UTC (05:00 Pacific) so the calendar day cannot shift.
 */
export function dayOfWeek(shiftDate: string): number {
  return new Date(`${shiftDate}T12:00:00Z`).getUTCDay()
}

/** Roster entries that work the given date. */
export function permanentRosterForDate(shiftDate: string): PermanentRosterEntry[] {
  const dow = dayOfWeek(shiftDate)
  return PERMANENT_ROSTER.filter((e) => e.days.includes(dow))
}

/** The time window an entry works on the given date. */
export function windowForEntry(entry: PermanentRosterEntry, shiftDate: string): ShiftWindow {
  return rangeShiftWindow(shiftDate, entry.start[0], entry.start[1], entry.end[0], entry.end[1])
}

/**
 * Radio call sign for a unit, or null where the post has none.
 *
 * Posts without one — the inspectors, the civilian staff, the buyers — are
 * shown by unit ID, since there is nothing better to call them.
 */
export function callSignForApparatus(apparatusId: string): string | null {
  return PERMANENT_ROSTER.find((e) => e.apparatusId === apparatusId)?.callSign ?? null
}

/** Every apparatus this roster can write to — used to seed and to validate. */
export const PERMANENT_ROSTER_APPARATUS: readonly string[] =
  PERMANENT_ROSTER.map((e) => e.apparatusId)
    .filter((id, i, all) => all.indexOf(id) === i)
