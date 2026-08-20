/**
 * Canonical row shape for the daily_assignments table.
 *
 * daily_assignments has two writers — the PDF importer (app/import/actions.ts)
 * and the schedule builder's publish route — and they used to emit disjoint
 * column sets:
 *
 *   importer  → start_dt, end_dt, hours_scheduled, is_ot   (no position/sort_order)
 *   publisher → position, sort_order, note, published_by   (no timestamps/hours)
 *
 * So a day entered by PDF could not be re-opened cleanly in the schedule
 * builder (no position, no ordering), and a day published from the builder
 * rendered on the crew board with "????–????" instead of shift times.
 *
 * Both writers now go through buildDailyAssignmentRow(), which always emits the
 * full column set. Readers select via the column lists at the bottom of this
 * file rather than hand-writing select strings.
 */

import { isLeave, isOvertime } from './assignment-types'
import { windowForAssignmentType, type ShiftWindow } from './shift-window'

/**
 * Position written for a row whose seat is unknown — the daily PDF lists who is
 * on an apparatus but not which seat they hold. Rows carrying a real seat
 * (anything sourced from shift_roster) keep their own value.
 */
export const UNKNOWN_POSITION = 'CREW'

/** Gap between generated sort_order values, leaving room to insert between. */
export const SORT_ORDER_STEP = 10

export interface DailyAssignmentInput {
  shiftDate:       string          // YYYY-MM-DD
  apparatusId:     string
  employeeId:      number | null   // null = open vacancy
  assignmentType:  string
  /** Seat on the apparatus. Defaults to UNKNOWN_POSITION. */
  position?:       string | null
  sortOrder?:      number
  note?:           string | null
  /** Explicit time window — the PDF importer passes the range it parsed. */
  window?:         ShiftWindow | null
  /** Explicit overtime flag — the PDF importer passes the PDF's type code. */
  isOt?:           boolean
  publishedBy?:    string | null
}

/** Exactly the columns written to daily_assignments. */
export interface DailyAssignmentRow {
  shift_date:      string
  apparatus_id:    string
  employee_id:     number | null
  position:        string
  assignment_type: string
  sort_order:      number
  note:            string | null
  start_dt:        string | null
  end_dt:          string | null
  hours_scheduled: number
  is_ot:           boolean
  published_by:    string | null
}

/**
 * Build one fully-populated daily_assignments row.
 *
 * Leave rows (vacation, sick, FMLA, …) get a null time window and zero hours:
 * the member is scheduled but not working, so claiming a 24-hour window would
 * misreport hours downstream.
 */
export function buildDailyAssignmentRow(input: DailyAssignmentInput): DailyAssignmentRow {
  const {
    shiftDate, apparatusId, employeeId, assignmentType,
    position, sortOrder, note, window, isOt, publishedBy,
  } = input

  const onLeave = isLeave(assignmentType)

  const resolvedWindow: ShiftWindow | null =
    window ?? (onLeave ? null : windowForAssignmentType(shiftDate, assignmentType))

  return {
    shift_date:      shiftDate,
    apparatus_id:    apparatusId,
    employee_id:     employeeId ?? null,
    position:        position?.trim() || UNKNOWN_POSITION,
    assignment_type: assignmentType,
    sort_order:      sortOrder ?? 0,
    note:            note ?? null,
    start_dt:        resolvedWindow?.startDt ?? null,
    end_dt:          resolvedWindow?.endDt ?? null,
    hours_scheduled: resolvedWindow?.hoursScheduled ?? 0,
    is_ot:           isOt ?? isOvertime(assignmentType),
    published_by:    publishedBy ?? null,
  }
}

/**
 * Assign sort_order values within an apparatus for rows that carry none
 * (the PDF lists crew in printed order but has no explicit ordering column).
 */
export function withGeneratedSortOrder<T>(
  rows: T[],
  apparatusIdOf: (row: T) => string,
): Array<{ row: T; sortOrder: number }> {
  const nextByApparatus = new Map<string, number>()

  return rows.map((row) => {
    const apparatusId = apparatusIdOf(row)
    const next = nextByApparatus.get(apparatusId) ?? 0
    nextByApparatus.set(apparatusId, next + SORT_ORDER_STEP)
    return { row, sortOrder: next }
  })
}

// ── Shared select column lists ────────────────────────────────────────────────

/**
 * Columns the crew board needs to render an apparatus card.
 *
 * Each list below must stay a single unbroken string literal: supabase-js
 * derives the result row type from the literal type of the select string, so
 * splitting one across concatenated pieces widens it to `string` and the query
 * loses its typing entirely.
 */
export const CREW_BOARD_COLUMNS = 'apparatus_id, employee_id, position, assignment_type, start_dt, end_dt, employees(first_name, last_name, rank, badge_number, is_paramedic, shift_assignment)'

/** Columns the schedule builder needs to re-open a published day. */
export const SCHEDULE_BUILDER_COLUMNS =
  'id, apparatus_id, employee_id, position, assignment_type, sort_order, note'

/** Columns the MOT / callback eligibility APIs need. */
export const ELIGIBILITY_COLUMNS = 'employee_id, assignment_type'

/** Eligibility columns plus the date, for rolling-window history queries. */
export const ELIGIBILITY_HISTORY_COLUMNS = 'employee_id, shift_date, assignment_type'
