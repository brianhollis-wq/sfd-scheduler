import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// SFD Fiscal Year starts July 1
function fiscalYear(date: Date): number {
  return date.getUTCMonth() >= 6 ? date.getUTCFullYear() + 1 : date.getUTCFullYear()
}

function fyEndDate(fy: number): string {
  // FY ends June 30 of the fiscal year number
  return `${fy}-06-30`
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dateParam = searchParams.get('date')

  const today = dateParam
    ? new Date(`${dateParam}T12:00:00Z`)
    : new Date()

  const todayStr = today.toISOString().split('T')[0]
  const fy       = fiscalYear(today)
  const fyEnd    = fyEndDate(fy)
  const supabase = createAdminClient()

  // Fetch all debit days from today through end of fiscal year
  const { data: rows, error } = await supabase
    .from('debit_days')
    .select('id, employee_id, employee_name, shift_letter, track, apparatus, position, debit_date, status, notes')
    .gte('debit_date', todayStr)
    .lte('debit_date', fyEnd)
    .order('debit_date', { ascending: true })
    .order('shift_letter', { ascending: true })
    .order('track', { ascending: true })
    .order('position', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const allDays = (rows ?? []).map((r: any) => ({
    id:           r.id,
    employeeId:   r.employee_id,
    employeeName: r.employee_name,
    shift:        r.shift_letter,
    track:        r.track,
    apparatus:    r.apparatus,
    position:     r.position,
    date:         r.debit_date,
    status:       r.status as 'scheduled' | 'worked' | 'covered_by_vacation' | 'cancelled',
    notes:        r.notes ?? null,
  }))

  // ── Today's debit workers ───────────────────────────────────
  const todayWorkers = allDays.filter(d => d.date === todayStr)

  // ── Upcoming (after today) ──────────────────────────────────
  const upcoming = allDays.filter(d => d.date > todayStr)

  // ── By employee: name → sorted list of their debit days ────
  const byEmployeeMap = new Map<string, typeof allDays>()
  for (const d of allDays) {
    if (!byEmployeeMap.has(d.employeeName)) byEmployeeMap.set(d.employeeName, [])
    byEmployeeMap.get(d.employeeName)!.push(d)
  }
  const byEmployee = Array.from(byEmployeeMap.entries())
    .map(([name, days]) => ({ name, days }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({
    asOf:        todayStr,
    fiscalYear:  fy,
    fyEnd,
    todayWorkers,
    upcoming,
    byEmployee,
  })
}
