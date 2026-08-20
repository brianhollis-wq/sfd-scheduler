/**
 * Shift time-window math, shared by the PDF importer and the schedule builder.
 *
 * These helpers used to live inside lib/parse-schedule.ts, which meant only
 * imported rows carried start_dt / end_dt / hours_scheduled. Published rows had
 * NULL timestamps and rendered on the crew board without shift times. Both
 * writers now build their windows here, so the two paths agree.
 *
 * NOTE ON TIMEZONE: every window below assumes Pacific Daylight Time (UTC−7)
 * year-round, which is the convention the PDF parser has always used. During
 * PST (roughly November–March) the stored UTC timestamps are therefore one hour
 * early. That is pre-existing behavior and is deliberately preserved here so
 * reconciliation does not silently shift historical data; fixing it is a
 * separate change that would need a backfill.
 */

export interface ShiftWindow {
  startDt: string        // ISO 8601, UTC
  endDt: string          // ISO 8601, UTC
  hoursScheduled: number
}

/** SFD shifts run in Pacific Daylight Time (UTC−7). */
const PDT_OFFSET_MINUTES = 7 * 60

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function addDays(shiftDate: string, days: number): string {
  const [year, month, day] = shiftDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

/**
 * Standard shift window.
 *   Full shift: 08:00–08:00 PDT = 15:00 UTC → 15:00 UTC next day (24 h)
 *   Half shift: 08:00–18:00 PDT = 15:00 UTC → 01:00 UTC next day (10 h)
 */
export function standardShiftWindow(shiftDate: string, isHalfShift = false): ShiftWindow {
  const startDt  = `${shiftDate}T15:00:00+00:00`
  const nextDate = addDays(shiftDate, 1)

  return isHalfShift
    ? { startDt, endDt: `${nextDate}T01:00:00+00:00`, hoursScheduled: 10.0 }
    : { startDt, endDt: `${nextDate}T15:00:00+00:00`, hoursScheduled: 24.0 }
}

/** Light duty window: 07:00–17:00 PDT = 14:00 UTC → 00:00 UTC next day (10 h). */
export function lightDutyShiftWindow(shiftDate: string): ShiftWindow {
  return {
    startDt:        `${shiftDate}T14:00:00+00:00`,
    endDt:          `${addDays(shiftDate, 1)}T00:00:00+00:00`,
    hoursScheduled: 10.0,
  }
}

/** A shift begins at 08:00 PDT and runs 24 hours. */
const SHIFT_START_MINUTES = 8 * 60

/**
 * Build a window from an explicit PDT local clock range, e.g. an inline
 * "17:00-20:30" on a PDF employee line.
 *
 * A clock range names hours, not a day, and the shift straddles midnight, so
 * the same printed range can mean either calendar day:
 *
 *   07:00-17:00   light duty, the morning of the shift date
 *   06:00-08:00   the last two hours of the shift, the following morning
 *
 * Anchoring every range to the shift date put that second one entirely before
 * the shift began — Weaver's three rows should tile his 24 hours (light duty
 * 08:00-18:00, Engine 1 18:00-06:00, light duty 06:00-08:00) and the last one
 * landed a day early, outside the shift altogether. A rule keyed on "before
 * 08:00 means tomorrow" would then have thrown light duty's 07:00 start onto
 * the wrong day instead.
 *
 * So the window is placed on whichever day puts more of it inside the shift,
 * which is the question actually being asked. Ties keep the shift date. If the
 * end clock time is at or before the start, the range wraps midnight and the
 * end lands a day after the start, as before.
 */
export function rangeShiftWindow(
  shiftDate: string,
  startHH: number, startMM: number,
  endHH: number,   endMM: number,
): ShiftWindow {
  const startLocal   = startHH * 60 + startMM
  const endLocal     = endHH   * 60 + endMM
  const durationMins = (endLocal <= startLocal ? endLocal + 1440 : endLocal) - startLocal

  // Minutes of this window that fall inside the shift, if it starts `offset`
  // minutes after the shift date's midnight.
  const overlap = (offset: number): number => {
    const s = startLocal + offset
    const e = s + durationMins
    return Math.max(0, Math.min(e, SHIFT_START_MINUTES + 1440) - Math.max(s, SHIFT_START_MINUTES))
  }
  const dayOffset = overlap(1440) > overlap(0) ? 1440 : 0

  const [year, month, day] = shiftDate.split('-').map(Number)
  const baseMs = Date.UTC(year, month - 1, day)

  const toUtcStamp = (localMins: number): string => {
    const utc  = localMins + PDT_OFFSET_MINUTES
    const date = new Date(baseMs + Math.floor(utc / 1440) * 86400000).toISOString().slice(0, 10)
    return `${date}T${pad2(Math.floor((utc % 1440) / 60))}:${pad2(utc % 60)}:00+00:00`
  }

  return {
    startDt:        toUtcStamp(startLocal + dayOffset),
    endDt:          toUtcStamp(startLocal + dayOffset + durationMins),
    hoursScheduled: Math.round((durationMins / 60) * 10) / 10,
  }
}

/**
 * Window for a row the schedule builder publishes. The builder has no clock
 * input — it assigns whole shifts — so this is the standard window, narrowed
 * for light duty.
 */
export function windowForAssignmentType(shiftDate: string, assignmentType: string): ShiftWindow {
  return assignmentType === 'light_duty'
    ? lightDutyShiftWindow(shiftDate)
    : standardShiftWindow(shiftDate)
}
