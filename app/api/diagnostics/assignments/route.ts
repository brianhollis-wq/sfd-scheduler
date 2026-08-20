/**
 * GET /api/diagnostics/assignments?date=YYYY-MM-DD
 *
 * Reports what the app itself sees in daily_assignments, so a disagreement
 * between the database and a page can be located rather than guessed at.
 *
 * It exists because the crew board fell back to an older date for 2026-08-19
 * while the schedule builder found rows for that same date, and a direct SQL
 * count showed 103. Those three cannot all be true, and nothing in the source
 * explains it — so this runs each query in turn and reports what came back.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { TABLES } from '@/lib/db/tables'
import { CREW_BOARD_COLUMNS, SCHEDULE_BUILDER_COLUMNS } from '@/lib/schedule/daily-assignment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const date = new URL(request.url).searchParams.get('date') ?? undefined

  // 1. The most recent date, exactly as the crew board's fallback asks for it.
  const latest = await supabase
    .from(TABLES.dailyAssignments)
    .select('shift_date')
    .order('shift_date', { ascending: false })
    .limit(1)
    .single()

  // 2. Distinct dates with counts, without ordering or limiting, so a row the
  //    query above cannot see still shows up here.
  const all = await supabase
    .from(TABLES.dailyAssignments)
    .select('shift_date')

  const counts: Record<string, number> = {}
  for (const row of (all.data ?? []) as { shift_date: string }[]) {
    const key = String(row.shift_date)
    counts[key] = (counts[key] ?? 0) + 1
  }

  const result: Record<string, unknown> = {
    latestQuery: {
      shiftDate: latest.data?.shift_date ?? null,
      error: latest.error?.message ?? null,
    },
    rowsSeenInTotal: (all.data ?? []).length,
    countsByDate: Object.fromEntries(
      Object.entries(counts).sort(([a], [b]) => b.localeCompare(a)).slice(0, 12),
    ),
    allError: all.error?.message ?? null,
  }

  if (date) {
    // 3. The two page queries, run side by side on the same date.
    const board = await supabase
      .from(TABLES.dailyAssignments)
      .select(CREW_BOARD_COLUMNS)
      .eq('shift_date', date)

    const builder = await supabase
      .from(TABLES.dailyAssignments)
      .select(SCHEDULE_BUILDER_COLUMNS)
      .eq('shift_date', date)

    const plain = await supabase
      .from(TABLES.dailyAssignments)
      .select('id, shift_date, apparatus_id, employee_id')
      .eq('shift_date', date)

    result.forDate = {
      date,
      crewBoardQuery:      { rows: board.data?.length ?? 0,   error: board.error?.message ?? null },
      scheduleBuilderQuery:{ rows: builder.data?.length ?? 0, error: builder.error?.message ?? null },
      plainQuery:          { rows: plain.data?.length ?? 0,   error: plain.error?.message ?? null },
      sampleShiftDateValue: (plain.data?.[0] as { shift_date?: string } | undefined)?.shift_date ?? null,
    }
  }

  return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } })
}
