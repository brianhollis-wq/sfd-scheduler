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

/**
 * Build a window from an explicit PDT local clock range, e.g. an inline
 * "17:00-20:30" on a PDF employee line. If the end clock time is at or before
 * the start clock time, the end lands on the next calendar day.
 */
export function rangeShiftWindow(
  shiftDate: string,
  startHH: number, startMM: number,
  endHH: number,   endMM: number,
): ShiftWindow {
  const startLocal = startHH * 60 + startMM
  const endLocal   = endHH   * 60 + endMM
  const endIsNextDay = endLocal <= startLocal

  const [year, month, day] = shiftDate.split('-').map(Number)
  const baseMs = Date.UTC(year, month - 1, day)

  // Start → UTC
  const startUtc  = startLocal + PDT_OFFSET_MINUTES
  const startDate = new Date(baseMs + Math.floor(startUtc / 1440) * 86400000).toISOString().slice(0, 10)
  const startDt   = `${startDate}T${pad2(Math.floor((startUtc % 1440) / 60))}:${pad2(startUtc % 60)}:00+00:00`

  // End → UTC
  const endAdj  = endLocal + (endIsNextDay ? 1440 : 0)
  const endUtc  = endAdj + PDT_OFFSET_MINUTES
  const endDate = new Date(baseMs + Math.floor(endUtc / 1440) * 86400000).toISOString().slice(0, 10)
  const endDt   = `${endDate}T${pad2(Math.floor((endUtc % 1440) / 60))}:${pad2(endUtc % 60)}:00+00:00`

  return {
    startDt,
    endDt,
    hoursScheduled: Math.round(((endAdj - startLocal) / 60) * 10) / 10,
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
