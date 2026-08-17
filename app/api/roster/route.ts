/**
 * GET /api/roster?date=YYYY-MM-DD
 *
 * Returns the pre-filled shift roster for a given date.
 * Looks up the shift letter from shift_calendar, then joins
 * shift_roster with employees and apparatuses to build the
 * daily assignment grid.
 *
 * Response shape:
 *   {
 *     date: string          // YYYY-MM-DD
 *     shiftLetter: string   // A | B | C | D
 *     apparatuses: ApparatusRoster[]
 *   }
 *
 * where ApparatusRoster = {
 *   apparatus_id: string
 *   call_sign: string
 *   type: string             // engine | truck | medic | bc | ...
 *   station_id: number | null
 *   station_name: string | null
 *   min_staffing: number
 *   positions: RosterPosition[]
 * }
 *
 * and RosterPosition = {
 *   id: number               // shift_roster.id
 *   position: string         // Captain | BC | ENG_P | FF_PM | ...
 *   sort_order: number
 *   note: string | null
 *   employee: {
 *     id: number
 *     first_name: string
 *     last_name: string
 *     rank: string
 *     badge_number: string
 *     is_paramedic: boolean
 *     shift_assignment: string | null
 *   } | null
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const dateParam = searchParams.get('date')

  if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json(
      { error: 'Missing or invalid ?date= parameter (expected YYYY-MM-DD)' },
      { status: 400 },
    )
  }

  const supabase = createAdminClient()

  // 1. Look up shift letter for this date
  const { data: calRow, error: calErr } = await supabase
    .from('shift_calendar')
    .select('shift_letter')
    .eq('shift_date', dateParam)
    .maybeSingle()

  if (calErr) {
    console.error('[roster] shift_calendar lookup error', calErr)
    return NextResponse.json({ error: calErr.message }, { status: 500 })
  }

  if (!calRow) {
    return NextResponse.json(
      { error: `No shift calendar entry found for ${dateParam}. Run shift-roster-seed.sql to populate shift_calendar.` },
      { status: 404 },
    )
  }

  const shiftLetter = calRow.shift_letter as string

  // 2. Pull all shift_roster rows for this shift letter, joined with employee info
  const { data: rosterRows, error: rosterErr } = await supabase
    .from('shift_roster')
    .select(`
      id,
      apparatus_id,
      shift_letter,
      position,
      sort_order,
      note,
      employees (
        id,
        first_name,
        last_name,
        rank,
        badge_number,
        is_paramedic,
        shift_assignment
      )
    `)
    .eq('shift_letter', shiftLetter)
    .order('apparatus_id')
    .order('sort_order')

  if (rosterErr) {
    console.error('[roster] shift_roster lookup error', rosterErr)
    return NextResponse.json({ error: rosterErr.message }, { status: 500 })
  }

  // 3. Pull apparatus metadata for all apparatuses that appear in the roster
  const apparatusIds = [...new Set((rosterRows ?? []).map((r) => r.apparatus_id))]

  const { data: apparatusRows, error: appErr } = await supabase
    .from('apparatuses')
    .select(`
      id,
      call_sign,
      type,
      station_id,
      min_staffing,
      stations ( id, name )
    `)
    .in('id', apparatusIds)

  if (appErr) {
    console.error('[roster] apparatuses lookup error', appErr)
    return NextResponse.json({ error: appErr.message }, { status: 500 })
  }

  const appMap = new Map(
    (apparatusRows ?? []).map((a) => [a.id, a])
  )

  // 4. Group roster rows by apparatus
  const grouped = new Map<string, typeof rosterRows>()
  for (const row of rosterRows ?? []) {
    const existing = grouped.get(row.apparatus_id) ?? []
    existing.push(row)
    grouped.set(row.apparatus_id, existing)
  }

  const apparatuses = [...grouped.entries()].map(([apparatus_id, positions]) => {
    const app = appMap.get(apparatus_id)
    return {
      apparatus_id,
      call_sign:    app?.call_sign ?? apparatus_id,
      type:         app?.type ?? 'engine',
      station_id:   app?.station_id ?? null,
      station_name: (app?.stations as { id: number; name: string } | null)?.name ?? null,
      min_staffing: app?.min_staffing ?? 3,
      positions:    positions.map((p) => ({
        id:         p.id,
        position:   p.position,
        sort_order: p.sort_order,
        note:       p.note ?? null,
        employee:   p.employees
          ? {
              id:               (p.employees as { id: number }).id,
              first_name:       (p.employees as { first_name: string }).first_name,
              last_name:        (p.employees as { last_name: string }).last_name,
              rank:             (p.employees as { rank: string }).rank,
              badge_number:     (p.employees as { badge_number: string }).badge_number,
              is_paramedic:     (p.employees as { is_paramedic: boolean }).is_paramedic,
              shift_assignment: (p.employees as { shift_assignment: string | null }).shift_assignment,
            }
          : null,
      })),
    }
  })

  // Sort: BC first, then by station, then by type
  const TYPE_ORDER: Record<string, number> = {
    bc: 0, engine: 1, truck: 2, medic: 3, rescue: 4, brush: 5, utility: 6,
  }
  apparatuses.sort((a, b) => {
    const ta = TYPE_ORDER[a.type] ?? 9
    const tb = TYPE_ORDER[b.type] ?? 9
    if (ta !== tb) return ta - tb
    if ((a.station_id ?? 99) !== (b.station_id ?? 99)) {
      return (a.station_id ?? 99) - (b.station_id ?? 99)
    }
    return a.apparatus_id.localeCompare(b.apparatus_id)
  })

  return NextResponse.json({
    date:        dateParam,
    shiftLetter,
    apparatuses,
  })
}
