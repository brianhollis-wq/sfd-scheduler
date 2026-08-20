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
  SORT_ORDER_STEP,
  type DailyAssignmentRow,
} from '@/lib/schedule/daily-assignment'
import { permanentRosterForDate, windowForEntry } from '@/lib/schedule/admin-roster'
import { findEmployee, type AdminClient } from '@/lib/employees/find'

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
  /** Permanent-roster people who could not be matched in the employees table. */
  unmatchedRoster?: string[]
  /** Permanent-roster apparatus missing from the apparatus table. */
  missingApparatus?: string[]
  error?:   string
}

// ────────────────────────────────────────────────────────────────
// Permanent roster expansion
// ────────────────────────────────────────────────────────────────

/**
 * Build daily_assignments rows for everyone whose assignment never appears in
 * the PDF — administration, specialty and REACH-1 crew. See
 * lib/schedule/admin-roster.ts.
 *
 * Entries whose apparatus is absent from the apparatus table are skipped, and
 * entries whose person cannot be matched in the employees table are reported
 * so they surface in the import result rather than vanishing.
 */
async function buildPermanentRosterRows(
  supabase: AdminClient,
  shiftDate: string,
  validApparatus: Set<string>,
  pdfRows: PreviewRow[],
): Promise<{
  rows: DailyAssignmentRow[]
  unmatched: string[]
  skippedApparatus: string[]
  supersededByPdf: string[]
}> {
  const entries = permanentRosterForDate(shiftDate)

  // The PDF wins, but only where the two actually collide in time.
  //
  // Comparing by apparatus alone is too blunt. A deputy fire marshal works
  // 0800-1700 and may also hold the 1700-0800 on-call rotation, which the PDF
  // prints under "ON Call DFM" against the same DFM-N unit. Those are two
  // non-overlapping shifts and both belong on the board; suppressing the
  // daytime row because the unit appears in the PDF would delete a day's work.
  //
  // Where the windows do overlap the PDF is authoritative — REACH-1 printing
  // a callback filling in for an absent regular, for instance — so neither the
  // absent person nor a duplicate of the person already listed is added.
  const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
    Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd)

  const pdfWindows = pdfRows.map((r) => ({
    apparatusId: r.apparatusId,
    employeeId:  r.employeeId,
    startDt:     r.startDt,
    endDt:       r.endDt,
  }))

  const rows: DailyAssignmentRow[] = []
  const unmatched: string[] = []
  const skippedApparatus: string[] = []
  const supersededByPdf: string[] = []
  const sortOrderByApparatus = new Map<string, number>()

  for (const entry of entries) {
    if (!validApparatus.has(entry.apparatusId)) {
      if (!skippedApparatus.includes(entry.apparatusId)) skippedApparatus.push(entry.apparatusId)
      continue
    }

    const entryWindow = windowForEntry(entry, shiftDate)

    if (pdfWindows.some((w) =>
      w.apparatusId === entry.apparatusId &&
      overlaps(entryWindow.startDt, entryWindow.endDt, w.startDt, w.endDt),
    )) {
      supersededByPdf.push(`${entry.apparatusId} (${entry.firstName} ${entry.lastName})`)
      continue
    }

    let employeeId = entry.employeeId ?? null
    if (employeeId == null) {
      const emp = await findEmployee(supabase, entry.firstName, entry.lastName)
      if (!emp) {
        unmatched.push(`${entry.firstName} ${entry.lastName} (${entry.apparatusId})`)
        continue
      }
      employeeId = emp.id
    }

    if (pdfWindows.some((w) =>
      w.employeeId === employeeId &&
      overlaps(entryWindow.startDt, entryWindow.endDt, w.startDt, w.endDt),
    )) {
      supersededByPdf.push(`${entry.firstName} ${entry.lastName} (${entry.apparatusId})`)
      continue
    }

    const sortOrder = sortOrderByApparatus.get(entry.apparatusId) ?? 0
    sortOrderByApparatus.set(entry.apparatusId, sortOrder + SORT_ORDER_STEP)

    rows.push(buildDailyAssignmentRow({
      shiftDate,
      apparatusId:    entry.apparatusId,
      employeeId,
      position:       entry.position,
      assignmentType: 'regular',
      sortOrder,
      window:         entryWindow,
      isOt:           false,
      publishedBy:    'permanent-roster',
    }))
  }

  return { rows, unmatched, skippedApparatus, supersededByPdf }
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

    // Administration, specialty and REACH-1 staff are never in the PDF.
    const { rows: rosterRows, unmatched, skippedApparatus, supersededByPdf } =
      await buildPermanentRosterRows(supabase, shiftDate, validApparatus, toInsert)

    if (supersededByPdf.length > 0) {
      console.info(
        `[import] ${shiftDate}: permanent-roster entries superseded by the PDF: ${supersededByPdf.join(', ')}`,
      )
    }

    if (rosterRows.length > 0) {
      const { error: rosterErr } = await supabase
        .from(TABLES.dailyAssignments)
        .insert(rosterRows)
      if (rosterErr) throw rosterErr

      insertedCount += rosterRows.length
    }

    return {
      inserted: insertedCount,
      skipped,
      ...(unmatched.length        > 0 ? { unmatchedRoster:  unmatched }        : {}),
      ...(skippedApparatus.length > 0 ? { missingApparatus: skippedApparatus } : {}),
    }
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
