/**
 * POST /api/assignments/publish
 *
 * Accepts a daily assignment grid and upserts it into daily_assignments.
 * Existing assignments for the given date are deleted then replaced
 * (full replace, not partial patch) so the board always reflects the
 * latest published state.
 *
 * Body (JSON):
 * {
 *   date:        string              // YYYY-MM-DD
 *   shiftLetter: string              // A | B | C | D
 *   entries: AssignmentEntry[]
 * }
 *
 * AssignmentEntry:
 * {
 *   apparatus_id:      string
 *   employee_id:       number | null   // null = open vacancy
 *   position:          string          // Captain | BC | ENG_P | FF_PM | ...
 *   assignment_type:   string          // regular | callback_voluntary | callback_mandatory | vacation | sick | ...
 *   sort_order:        number
 *   note:              string | null
 * }
 *
 * The daily_assignments table schema:
 *   CREATE TABLE IF NOT EXISTS daily_assignments (
 *     id              serial PRIMARY KEY,
 *     shift_date      date NOT NULL,
 *     apparatus_id    text NOT NULL REFERENCES apparatuses(id),
 *     employee_id     integer REFERENCES employees(id) ON DELETE SET NULL,
 *     position        text NOT NULL,
 *     assignment_type text NOT NULL DEFAULT 'regular',
 *     sort_order      smallint NOT NULL DEFAULT 0,
 *     note            text,
 *     published_by    text,   -- free-text for now; can be a user ID later
 *     created_at      timestamptz NOT NULL DEFAULT now(),
 *     updated_at      timestamptz NOT NULL DEFAULT now()
 *   );
 *   CREATE INDEX IF NOT EXISTS daily_assignments_date_idx ON daily_assignments (shift_date);
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
  date:        string
  shiftLetter: string
  entries:     AssignmentEntry[]
  publishedBy?: string
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

  const supabase = createAdminClient()

  // Delete existing assignments for this date, then insert fresh
  const { error: deleteErr } = await supabase
    .from('daily_assignments')
    .delete()
    .eq('shift_date', date)

  if (deleteErr) {
    console.error('[publish] delete error', deleteErr)
    return NextResponse.json({ error: deleteErr.message }, { status: 500 })
  }

  if (entries.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0 })
  }

  const rows = entries.map((e) => ({
    shift_date:      date,
    apparatus_id:    e.apparatus_id,
    employee_id:     e.employee_id ?? null,
    position:        e.position,
    assignment_type: e.assignment_type ?? 'regular',
    sort_order:      e.sort_order ?? 0,
    note:            e.note ?? null,
    published_by:    publishedBy ?? null,
  }))

  const { error: insertErr, count } = await supabase
    .from('daily_assignments')
    .insert(rows, { count: 'exact' })

  if (insertErr) {
    console.error('[publish] insert error', insertErr)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, inserted: count })
}
