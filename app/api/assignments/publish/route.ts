/**
 * POST /api/assignments/publish
 *
 * Accepts a daily assignment grid from the schedule builder and replaces
 * daily_assignments for that date (full replace, not a partial patch) so the
 * crew board always reflects the latest published state.
 *
 * Rows are built by buildDailyAssignmentRow(), the same helper the PDF importer
 * uses, so a published day and an imported day are column-for-column identical.
 * Before that was shared, published rows carried no start_dt/end_dt/hours and
 * the crew board rendered them as "????–????".
 *
 * Body (JSON):
 * {
 *   date:        string              // YYYY-MM-DD
 *   shiftLetter: string              // A | B | C | D
 *   publishedBy?: string
 *   entries: AssignmentEntry[]
 * }
 *
 * AssignmentEntry:
 * {
 *   apparatus_id:      string
 *   employee_id:       number | null   // null = open vacancy
 *   position:          string          // Captain | BC | ENG_P | FF_PM | ...
 *   assignment_type:   string          // see lib/schedule/assignment-types
 *   sort_order:        number
 *   note:              string | null
 * }
 *
 * See db/001_daily_assignments_reconcile.sql for the columns this writes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { TABLES } from '@/lib/db/tables'
import { buildDailyAssignmentRow } from '@/lib/schedule/daily-assignment'
import { ON_DUTY_TYPES, LEAVE_TYPES, INTERN_TYPES } from '@/lib/schedule/assignment-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface AssignmentEntry {
  apparatus_id:    string
  employee_id:     number | null
  position:        string
  assignment_type: string
  sort_order:      number
  note:            string | null
}

interface PublishBody {
  date:         string
  shiftLetter:  string
  entries:      AssignmentEntry[]
  publishedBy?: string
}

function isKnownAssignmentType(t: string): boolean {
  return ON_DUTY_TYPES.has(t) || LEAVE_TYPES.has(t) || INTERN_TYPES.has(t)
}

export async function POST(request: NextRequest) {
  let body: PublishBody
  try {
    body = await request.json() as PublishBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { date, shiftLetter, entries, publishedBy } = body

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Missing or invalid date (YYYY-MM-DD)' }, { status: 400 })
  }
  if (!shiftLetter || !/^[ABCD]$/.test(shiftLetter)) {
    return NextResponse.json({ error: 'Missing or invalid shiftLetter (A|B|C|D)' }, { status: 400 })
  }
  if (!Array.isArray(entries)) {
    return NextResponse.json({ error: 'entries must be an array' }, { status: 400 })
  }

  // Reject unknown assignment types up front. Downstream readers (crew board,
  // MOT and callback eligibility) key entirely off assignment_type, so a typo
  // here would silently drop a member out of every staffing and OT calculation.
  const unknownTypes = entries
    .map((e) => e.assignment_type)
    .filter((t, i, all) => t && !isKnownAssignmentType(t) && all.indexOf(t) === i)
  if (unknownTypes.length > 0) {
    return NextResponse.json(
      { error: `Unknown assignment_type: ${unknownTypes.join(', ')}` },
      { status: 400 },
    )
  }

  const invalidApparatus = entries.filter((e) => !e.apparatus_id)
  if (invalidApparatus.length > 0) {
    return NextResponse.json({ error: 'Every entry needs an apparatus_id' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Delete existing assignments for this date, then insert fresh
  const { error: deleteErr } = await supabase
    .from(TABLES.dailyAssignments)
    .delete()
    .eq('shift_date', date)

  if (deleteErr) {
    console.error('[publish] delete error', deleteErr)
    return NextResponse.json({ error: deleteErr.message }, { status: 500 })
  }

  if (entries.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0 })
  }

  const rows = entries.map((e) => buildDailyAssignmentRow({
    shiftDate:      date,
    apparatusId:    e.apparatus_id,
    employeeId:     e.employee_id,
    position:       e.position,
    assignmentType: e.assignment_type || 'regular',
    sortOrder:      e.sort_order,
    note:           e.note,
    publishedBy:    publishedBy ?? null,
  }))

  const { error: insertErr, count } = await supabase
    .from(TABLES.dailyAssignments)
    .insert(rows, { count: 'exact' })

  if (insertErr) {
    console.error('[publish] insert error', insertErr)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, inserted: count ?? rows.length })
}
