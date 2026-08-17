'use server'

/**
 * Server actions for the SFD Schedule Import page.
 * PDF parsing is handled by POST /api/parse-pdf (Route Handler).
 * Only the DB commit lives here as a Server Action.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { ParsedRow } from '@/lib/parse-schedule'

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
  hours_scheduled: number
  is_ot:           boolean
}> = [
  { employee_id: 2830, assignment_type: 'regular', hours_scheduled: 24, is_ot: false }, // Scott Alt
  { employee_id: 7356, assignment_type: 'regular', hours_scheduled: 24, is_ot: false }, // Amanda Palmer
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
      .from('daily_assignments')
      .delete()
      .eq('shift_date', shiftDate)
    if (delErr) throw delErr

    // Fetch all valid apparatus IDs so we can skip FK violations
    const { data: apparatusRows, error: apErr } = await supabase
      .from('apparatus')
      .select('id')
    if (apErr) throw apErr
    const validApparatus = new Set((apparatusRows ?? []).map((a: { id: string }) => a.id))

    const matched = rows.filter((r) => r.matched && r.employeeId !== null)
    const toInsert = matched.filter((r) => validApparatus.has(r.apparatusId))
    const skipped  = rows.length - toInsert.length

    if (toInsert.length === 0 && !isTueToFri(shiftDate)) return { inserted: 0, skipped }

    let insertedCount = 0

    if (toInsert.length > 0) {
      const { error: insErr } = await supabase.from('daily_assignments').insert(
        toInsert.map((r) => ({
          shift_date:      shiftDate,
          apparatus_id:    r.apparatusId,
          employee_id:     r.employeeId,
          assignment_type: r.assignmentType,
          start_dt:        r.startDt,
          end_dt:          r.endDt,
          hours_scheduled: r.hoursScheduled,
          is_ot:           r.isOt,
        })),
      )
      if (insErr) throw insErr
      insertedCount = toInsert.length
    }

    // Auto-populate REACH-1 on Tue–Fri with permanent crew (Scott Alt & Amanda Palmer).
    // These employees never appear in the daily PDF, so we always upsert them here.
    if (isTueToFri(shiftDate) && validApparatus.has(REACH1_APPARATUS_ID)) {
      const reach1Rows = REACH1_PERMANENT_CREW.map((c) => ({
        shift_date:      shiftDate,
        apparatus_id:    REACH1_APPARATUS_ID,
        employee_id:     c.employee_id,
        assignment_type: c.assignment_type,
        hours_scheduled: c.hours_scheduled,
        is_ot:           c.is_ot,
      }))

      const { error: r1Err } = await supabase
        .from('daily_assignments')
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
