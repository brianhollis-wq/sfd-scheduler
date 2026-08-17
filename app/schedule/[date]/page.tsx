/**
 * /schedule/[date]
 *
 * Server component — loads daily_assignments when they exist for the date
 * (full crew with OT/trade/callback types), otherwise falls back to shift_roster
 * (base regular crew only).
 *
 * Derives apparatus metadata from ID string — no apparatus table needed.
 */

import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import ScheduleBuilder, { type ApparatusRoster } from './ScheduleBuilder'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  params: { date: string }
}

type EmployeeRow = {
  id: number
  first_name: string
  last_name: string
  rank: string
  badge_number: string
  is_paramedic: boolean
  shift_assignment: string | null
}

// Derive type/staffing from apparatus ID string
function apparatusMeta(id: string): { type: string; min_staffing: number; station_id: number | null } {
  const upper = id.toUpperCase()
  if (upper.startsWith('BC-'))     return { type: 'bc',     min_staffing: 1, station_id: null }
  if (upper.startsWith('TR-'))     return { type: 'truck',  min_staffing: 3, station_id: parseInt(upper.slice(3)) || null }
  if (upper.startsWith('M-'))      return { type: 'medic',  min_staffing: 2, station_id: parseInt(upper.slice(2)) || null }
  if (upper.startsWith('E-'))      return { type: 'engine', min_staffing: 3, station_id: parseInt(upper.slice(2)) || null }
  if (upper.startsWith('BRUSH-'))  return { type: 'brush',  min_staffing: 2, station_id: parseInt(upper.slice(6)) || null }
  if (upper.startsWith('BR-'))     return { type: 'brush',  min_staffing: 2, station_id: parseInt(upper.slice(3)) || null }
  return { type: 'engine', min_staffing: 3, station_id: null }
}

// ── Shared row shape ──────────────────────────────────────────────────────────

type SourceRow = {
  id: number
  apparatus_id: string
  employee_id: number | null
  position: string
  assignment_type: string
  sort_order: number
  note: string | null
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function getRosterForDate(date: string): Promise<{
  shiftLetter: string
  source: 'daily' | 'roster'
  apparatuses: ApparatusRoster[]
} | null> {
  const supabase = createAdminClient()

  // 1. Shift letter for this date
  const { data: calRow } = await supabase
    .from('shift_calendar')
    .select('shift_letter')
    .eq('shift_date', date)
    .maybeSingle()

  if (!calRow) return null
  const shiftLetter = calRow.shift_letter as string

  // 2. Try daily_assignments first (has full OT/callback/trade crew)
  const { data: dailyRows } = await supabase
    .from('daily_assignments')
    .select('id, apparatus_id, employee_id, position, assignment_type, sort_order, note')
    .eq('shift_date', date)
    .order('apparatus_id')
    .order('sort_order')

  let sourceRows: SourceRow[]
  let source: 'daily' | 'roster'

  if (dailyRows && dailyRows.length > 0) {
    // Use daily_assignments — full actual crew
    source = 'daily'
    sourceRows = dailyRows.map((r) => ({
      id:              r.id as number,
      apparatus_id:    r.apparatus_id as string,
      employee_id:     r.employee_id as number | null,
      position:        r.position as string,
      assignment_type: r.assignment_type as string,
      sort_order:      r.sort_order as number,
      note:            (r.note ?? null) as string | null,
    }))
  } else {
    // Fall back to shift_roster — base regular crew
    source = 'roster'
    const { data: rosterRows, error: rosterErr } = await supabase
      .from('shift_roster')
      .select('id, apparatus_id, position, sort_order, note, employee_id')
      .eq('shift_letter', shiftLetter)
      .order('apparatus_id')
      .order('sort_order')

    if (rosterErr) throw new Error(rosterErr.message)

    sourceRows = (rosterRows ?? []).map((r) => ({
      id:              r.id as number,
      apparatus_id:    r.apparatus_id as string,
      employee_id:     r.employee_id as number | null,
      position:        r.position as string,
      assignment_type: 'regular',
      sort_order:      r.sort_order as number,
      note:            (r.note ?? null) as string | null,
    }))
  }

  // 3. Apparatus list — unique IDs from source rows
  const allApparatusIds = [...new Set(sourceRows.map((r) => r.apparatus_id))]

  // 4. Employee lookup
  const employeeIds = [
    ...new Set(
      sourceRows
        .map((r) => r.employee_id)
        .filter((id): id is number => id != null),
    ),
  ]

  const employeeMap = new Map<number, EmployeeRow>()

  if (employeeIds.length > 0) {
    const { data: empRows, error: empErr } = await supabase
      .from('employees')
      .select('id, first_name, last_name, rank, badge_number, is_paramedic, shift_assignment')
      .in('id', employeeIds)

    if (empErr) throw new Error(empErr.message)
    for (const emp of empRows ?? []) {
      employeeMap.set(emp.id as number, emp as EmployeeRow)
    }
  }

  // 5. Group rows by apparatus
  const rowsByApparatus = new Map<string, SourceRow[]>()
  for (const row of sourceRows) {
    const existing = rowsByApparatus.get(row.apparatus_id) ?? []
    existing.push(row)
    rowsByApparatus.set(row.apparatus_id, existing)
  }

  // 6. Build apparatus list
  const TYPE_ORDER: Record<string, number> = {
    bc: 0, engine: 1, truck: 2, medic: 3, rescue: 4, brush: 5, utility: 6,
  }

  const apparatuses: ApparatusRoster[] = allApparatusIds.map((apparatus_id) => {
    const meta = apparatusMeta(apparatus_id)
    const positions = (rowsByApparatus.get(apparatus_id) ?? [])
      .filter((p) => p.employee_id != null)
      .map((p) => ({
        id:             p.id,
        position:       p.position,
        sort_order:     p.sort_order,
        note:           p.note,
        assignmentType: p.assignment_type,
        employee:       employeeMap.get(p.employee_id as number) ?? null,
      }))

    return {
      apparatus_id,
      call_sign:    apparatus_id,
      type:         meta.type,
      station_id:   meta.station_id,
      station_name: meta.station_id != null ? `Station ${meta.station_id}` : null,
      min_staffing: meta.min_staffing,
      positions,
    }
  })

  apparatuses.sort((a, b) => {
    const ta = TYPE_ORDER[a.type] ?? 9
    const tb = TYPE_ORDER[b.type] ?? 9
    if (ta !== tb) return ta - tb
    if ((a.station_id ?? 99) !== (b.station_id ?? 99)) {
      return (a.station_id ?? 99) - (b.station_id ?? 99)
    }
    return a.apparatus_id.localeCompare(b.apparatus_id)
  })

  return { shiftLetter, source, apparatuses }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function SchedulePage({ params }: PageProps) {
  const { date } = params

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound()

  const roster = await getRosterForDate(date)

  if (!roster) {
    return (
      <div className="min-h-screen bg-[#060f1a] text-zinc-200 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="font-mono font-bold text-xl text-zinc-300">No Roster Found</div>
          <div className="text-zinc-500 font-mono text-sm">
            No shift calendar entry for <span className="text-zinc-300">{date}</span>
          </div>
          <a href="/schedule" className="inline-block mt-4 text-sky-400 hover:text-sky-300 font-mono text-sm">
            ← Back to Schedule
          </a>
        </div>
      </div>
    )
  }

  return (
    <ScheduleBuilder
      date={date}
      shiftLetter={roster.shiftLetter}
      apparatuses={roster.apparatuses}
      dataSource={roster.source}
    />
  )
}
