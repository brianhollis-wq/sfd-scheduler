'use server'

/**
 * Server actions for the SFD Schedule Import page.
 * PDF parsing is handled by POST /api/parse-pdf (Route Handler).
 * Only the DB commit lives here as a Server Action.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { ParsedRow } from '@/lib/parse-schedule'
import { TABLES } from '@/lib/db/tables'
import {
  buildDailyAssignmentRow,
  withGeneratedSortOrder,
} from '@/lib/schedule/daily-assignment'
import { standardShiftWindow } from '@/lib/schedule/shift-window'

// ────────────────────────────────────────────────────────────────
// Types shared with the client
// ────────────────────────────────────────────────────────────────

export interface PreviewRow extends ParsedRow {
  employeeId:      number | null
  employeeDisplay: string | null
  matched:         boolean
}

export interface CommitResult {
  inserted: number
  skipped:  number
  error?:   string
}

// ────────────────────────────────────────────────────────────────
// REACH-1 permanent crew (always Tue–Fri, never in the PDF)
// ────────────────────────────────────────────────────────────────

const REACH1_APPARATUS_ID = 'REACH-1'

const REACH1_PERMANENT_CREW: Array<{
  employee_id:     number
  assignment_type: string
}> = [
  { employee_id: 2830, assignment_type: 'regular' }, // Scott Alt
  { employee_id: 7356, assignment_type: 'regular' }, // Amanda Palmer
]

/** Returns true if a YYYY-MM-DD date string falls on Tuesday–Friday UTC. */
function isTueToFri(dateStr: string): boolean {
  // Parse at noon UTC to avoid any DST / timezone shifts near midnight
  const day = new Date(dateStr + 'T12:00:00Z').getUTCDay() // 0=Sun … 6=Sat
  return day >= 2 && day <= 5
}

// ────────────────────────────────────────────────────────────────
// commitScheduleAction
// ────────────────────────────────────────────────────────────────

export async function commitScheduleAction(
  shiftDate: string,
  rows: PreviewRow[],
): Promise<CommitResult> {
  try {
    const supabase = createAdminClient()

    // Delete all existing assignments for this date
    const { error: delErr } = await supabase
      .from(TABLES.dailyAssignments)
      .delete()
      .eq('shift_date', shiftDate)
    if (delErr) throw delErr

    // Fetch all valid apparatus IDs so we can skip FK violations
    const { data: apparatusRows, error: apErr } = await supabase
      .from(TABLES.apparatus)
      .select('id')
    if (apErr) throw apErr
    const validApparatus = new Set((apparatusRows ?? []).map((a: { id: string }) => a.id))

    const matched = rows.filter((r) => r.matched && r.employeeId !== null)
    const toInsert = matched.filter((r) => validApparatus.has(r.apparatusId))
    const skipped  = rows.length - toInsert.length

    if (toInsert.length === 0 && !isTueToFri(shiftDate)) return { inserted: 0, skipped }

    let insertedCount = 0

    if (toInsert.length > 0) {
      // The PDF lists crew in printed order per apparatus but carries no seat
      // or ordering column, so sort_order is generated here and `position`
      // falls back to UNKNOWN_POSITION inside buildDailyAssignmentRow. Without
      // both, a day imported from PDF could not be re-opened in the schedule
      // builder, which orders and labels rows by exactly those columns.
      const ordered = withGeneratedSortOrder(toInsert, (r) => r.apparatusId)

      const { error: insErr } = await supabase.from(TABLES.dailyAssignments).insert(
        ordered.map(({ row: r, sortOrder }) => buildDailyAssignmentRow({
          shiftDate,
          apparatusId:    r.apparatusId,
          employeeId:     r.employeeId,
          assignmentType: r.assignmentType,
          sortOrder,
          // The parser already resolved the window from the PDF (inline time
          // ranges, half shifts, light duty) and the OT type code — pass both
          // through rather than re-deriving them from assignment_type.
          window:         { startDt: r.startDt, endDt: r.endDt, hoursScheduled: r.hoursScheduled },
          isOt:           r.isOt,
          publishedBy:    'pdf-import',
        })),
      )
      if (insErr) throw insErr
      insertedCount = toInsert.length
    }

    // Auto-populate REACH-1 on Tue–Fri with permanent crew (Scott Alt & Amanda Palmer).
    // These employees never appear in the daily PDF, so we always upsert them here.
    if (isTueToFri(shiftDate) && validApparatus.has(REACH1_APPARATUS_ID)) {
      const reach1Rows = REACH1_PERMANENT_CREW.map((c, i) => buildDailyAssignmentRow({
        shiftDate,
        apparatusId:    REACH1_APPARATUS_ID,
        employeeId:     c.employee_id,
        assignmentType: c.assignment_type,
        sortOrder:      i * 10,
        window:         standardShiftWindow(shiftDate),
        publishedBy:    'pdf-import',
      }))

      const { error: r1Err } = await supabase
        .from(TABLES.dailyAssignments)
        .insert(reach1Rows)
      if (r1Err) throw r1Err

      insertedCount += reach1Rows.length
    }

    return { inserted: insertedCount, skipped }
  } catch (err: unknown) {
    // Supabase errors are plain objects with a `message` field, not Error instances
    let msg: string
    if (err instanceof Error) {
      msg = err.message
    } else if (typeof err === 'object' && err !== null) {
      const e = err as Record<string, unknown>
      msg = [e.message, e.details, e.hint, e.code]
        .filter(Boolean)
        .map(String)
        .join(' | ') || JSON.stringify(err)
    } else {
      msg = String(err)
    }
    return { inserted: 0, skipped: 0, error: `Commit failed: ${msg}` }
  }
}
