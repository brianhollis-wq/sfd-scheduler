/**
 * Permanent roster — people whose assignment never appears in the daily PDF.
 *
 * The daily schedule PDF covers line personnel. Administration, specialty and
 * REACH-1 staff work fixed weekday schedules and are simply absent from it, so
 * they are expanded from this table whenever a day is committed.
 *
 * ON-CALL IS NOT HERE. The DFM after-hours rotation (1700–0800 weekdays,
 * 0800–0800 weekends) does appear in the PDF, under an "ON Call DFM" section
 * that lib/parse-schedule.ts already resolves per-employee from the (FM-N) call
 * sign. This table is daytime assignments only; adding call here would
 * double-book whoever the PDF already named.
 */

import { rangeShiftWindow, standardShiftWindow, type ShiftWindow } from './shift-window'

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
   * Set only where the employee ID is already known and pinned. Skips name
   * resolution entirely.
   */
  employeeId?: number
  /** Days worked, 0 = Sunday. */
  days: readonly number[]
  /** Local start/end clock times, 24h. Pacific, per shift-window.ts. */
  start: [number, number]
  end: [number, number]
  /** True for a full 24-hour shift; start/end are then ignored. */
  fullShift?: boolean
}

// ── The roster ────────────────────────────────────────────────────────────────

export const PERMANENT_ROSTER: readonly PermanentRosterEntry[] = [
  // ── Community Risk Reduction — deputy fire marshals, weekdays 0800–1700 ────
  // The zone numbers beside each name on the CRR roster (e.g. "Roth (FM2) - 5,
  // 11") are the districts they cover, not a schedule.
  { apparatusId: 'DFM-1', position: 'Fire Marshal', firstName: 'Sean',   lastName: 'Mansfield', days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'DFM-2', position: 'DFM',          firstName: 'Sara',   lastName: 'Roth',      days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'DFM-3', position: 'DFM',          firstName: 'Justin', lastName: 'Guinan',    days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'DFM-4', position: 'DFM',          firstName: 'Jordan', lastName: 'Wakem',     days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'DFM-5', position: 'DFM',          firstName: 'Janet',  lastName: 'Campbell',  days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'DFM-6', position: 'DFM',          firstName: 'Robert', lastName: 'Johnson',   days: MON_FRI, start: [8, 0], end: [17, 0] },

  // Inspectors — weekdays 0800–1700, no after-hours call rotation.
  { apparatusId: 'INSP-1', position: 'Inspector I', firstName: 'Diego',  lastName: 'Legorreta', days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'INSP-2', position: 'Inspector I', firstName: 'Arthur', lastName: 'Zhiryada',  days: MON_FRI, start: [8, 0], end: [17, 0] },

  // ── Training division ─────────────────────────────────────────────────────
  { apparatusId: 'TR-DC',   position: 'DC Training', firstName: 'Michael', lastName: 'Walker',      days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'TR-CPT1', position: 'TO2',         firstName: 'Scott',   lastName: 'Miller',      days: MON_THU, start: [7, 0], end: [17, 0] },
  { apparatusId: 'TR-CPT2', position: 'TO3',         firstName: 'Paul',    lastName: 'Bridgehouse', days: MON_THU, start: [7, 0], end: [17, 0] },
  { apparatusId: 'TR-AO',   position: 'TO4',         firstName: 'Matthew', lastName: 'Miller',      days: TUE_FRI, start: [7, 0], end: [17, 0] },

  // ── EMS division ──────────────────────────────────────────────────────────
  { apparatusId: 'EMS-DC',    position: 'DC EMS',          firstName: 'Stephen', lastName: 'Boughey', days: MON_FRI, start: [8, 0], end: [17, 0] },
  { apparatusId: 'EMS-COORD', position: 'EMS Coordinator', firstName: 'Darrin',  lastName: 'George',  days: MON_THU, start: [7, 0], end: [17, 0] },
  { apparatusId: 'EMS-TRN',   position: 'EMS Trainer',     firstName: 'Katie',   lastName: 'Cardona', days: MON_THU, start: [7, 0], end: [17, 0] },

  // ── REACH-1 — permanent crew, Tue–Fri, full shift ─────────────────────────
  // Employee IDs were already pinned here before this table existed; kept
  // pinned rather than re-resolved by name.
  { apparatusId: 'REACH-1', position: 'CREW', firstName: 'Scott',  lastName: 'Alt',    employeeId: 2830, days: TUE_FRI, start: [8, 0], end: [8, 0], fullShift: true },
  { apparatusId: 'REACH-1', position: 'CREW', firstName: 'Amanda', lastName: 'Palmer', employeeId: 7356, days: TUE_FRI, start: [8, 0], end: [8, 0], fullShift: true },
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
  return entry.fullShift
    ? standardShiftWindow(shiftDate)
    : rangeShiftWindow(shiftDate, entry.start[0], entry.start[1], entry.end[0], entry.end[1])
}

/** Every apparatus this roster can write to — used to seed and to validate. */
export const PERMANENT_ROSTER_APPARATUS: readonly string[] =
  PERMANENT_ROSTER.map((e) => e.apparatusId)
    .filter((id, i, all) => all.indexOf(id) === i)
