import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// SFD Fiscal Year starts July 1
function fiscalYear(date: Date): number {
  return date.getUTCMonth() >= 6 ? date.getUTCFullYear() + 1 : date.getUTCFullYear()
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function toDateStr(date: Date): string {
  return date.toISOString().split('T')[0]
}

const ON_DUTY_TYPES = new Set([
  'regular',
  'callback_voluntary',
  'callback_mandatory',
  'peak_engine',
  'trade',
])

const LEAVE_LABELS: Record<string, string> = {
  vacation:  'Vacation',
  sick:      'Sick',
  FMLA:      'FMLA',
  OFLA:      'OFLA',
  PLO:       'PLO',
  injury:    'Injury Leave',
  kelly_day: 'Kelly Day',
  WOC:       'WOC',
  AIC:       'AIC',
  BUM:       'BUM',
}

const CALLBACK_LISTS = [
  { type: 'Captain_vol',  label: 'Captain',        singleRole: false },
  { type: 'Engineer_vol', label: 'Engineer (AO)',   singleRole: false },
  { type: 'FF_vol',       label: 'FF / Paramedic',  singleRole: false },
  { type: 'SRP_vol',      label: 'SR Paramedic',    singleRole: true  },
  { type: 'SRE_vol',      label: 'SR EMT',          singleRole: true  },
]

// Voluntary OT limits — applied to single-role classifications only (SRP, SRE)
const HOURS_PER_SHIFT    = 24
const MAX_HOURS_ROLLING  = 72   // can't exceed 72 hrs in rolling window
const ROLLING_WINDOW     = 6    // look back 6 days (+ target = 7-day window)
const MAX_CONSEC_DAYS    = 5    // more than 5 consecutive days = ineligible

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dateParam = searchParams.get('date')

  const targetDate = dateParam
    ? new Date(`${dateParam}T12:00:00Z`)
    : new Date()

  const shiftDate = toDateStr(targetDate)
  const fy        = fiscalYear(targetDate)
  const supabase  = createAdminClient()

  // ── Assignments for the target shift date ────────────────────
  const { data: assignments, error: assignErr } = await supabase
    .from('daily_assignments')
    .select('employee_id, assignment_type')
    .eq('shift_date', shiftDate)

  if (assignErr) {
    return NextResponse.json({ error: assignErr.message }, { status: 500 })
  }

  // employee_id → assignment_type (on-duty wins over leave if multiple rows)
  const assignMap = new Map<number, string>()
  for (const a of (assignments ?? [])) {
    const existing = assignMap.get(a.employee_id)
    if (!existing || ON_DUTY_TYPES.has(a.assignment_type)) {
      assignMap.set(a.employee_id, a.assignment_type)
    }
  }

  // ── Debit day workers on the target date ─────────────────────
  // Debit days live in their own table; status='scheduled' means they're working it
  const { data: debitToday, error: debitTodayErr } = await supabase
    .from('debit_days')
    .select('employee_id')
    .eq('debit_date', shiftDate)
    .eq('status', 'scheduled')
    .not('employee_id', 'is', null)

  if (debitTodayErr) {
    return NextResponse.json({ error: debitTodayErr.message }, { status: 500 })
  }

  // Set of employee_ids working a debit day today
  const debitTodaySet = new Set<number>(
    (debitToday ?? []).map((r: any) => r.employee_id).filter(Boolean)
  )

  // ── Historical on-duty days for 72-hr / consecutive-day checks ──
  // Look at the 6 days *before* the target date
  const windowStart = toDateStr(addDays(targetDate, -ROLLING_WINDOW))
  const windowEnd   = toDateStr(addDays(targetDate, -1))

  // Single-role classifications (SRP, SRE) don't have debit days, so only
  // daily_assignments needs to be checked for the 72-hr / consecutive-day history.
  const { data: histRows, error: histErr } = await supabase
    .from('daily_assignments')
    .select('employee_id, shift_date, assignment_type')
    .gte('shift_date', windowStart)
    .lte('shift_date', windowEnd)
    .in('assignment_type', [...ON_DUTY_TYPES])

  if (histErr) {
    return NextResponse.json({ error: histErr.message }, { status: 500 })
  }

  // employee_id → Set of date strings where they were on-duty
  const histMap = new Map<number, Set<string>>()
  for (const a of (histRows ?? [])) {
    if (!histMap.has(a.employee_id)) histMap.set(a.employee_id, new Set())
    histMap.get(a.employee_id)!.add(a.shift_date)
  }

  // On-duty days in the rolling window (not counting target day)
  function priorOnDutyDays(empId: number): number {
    return histMap.get(empId)?.size ?? 0
  }

  // Consecutive on-duty days immediately before the target date
  function consecutiveDaysBefore(empId: number): number {
    const days = histMap.get(empId)
    if (!days) return 0
    let streak = 0
    for (let i = 1; i <= ROLLING_WINDOW; i++) {
      if (days.has(toDateStr(addDays(targetDate, -i)))) streak++
      else break
    }
    return streak
  }

  // ── Build each classification ────────────────────────────────
  const classifications = []

  for (const list of CALLBACK_LISTS as Array<{ type: string; label: string; singleRole: boolean }>) {
    const { data: rows, error: listErr } = await supabase
      .from('ot_list_positions')
      .select(`
        id,
        employee_id,
        mandatory_rank,
        last_mandatory_date,
        times_mandatoried,
        employees (
          first_name,
          last_name,
          rank,
          shift_assignment
        )
      `)
      .eq('list_type', list.type)
      .eq('fiscal_year', fy)
      .eq('is_active', true)
      .order('mandatory_rank', { ascending: true })

    if (listErr) {
      return NextResponse.json({ error: listErr.message }, { status: 500 })
    }

    const members = (rows ?? []).map((m: any) => {
      const empId      = m.employee_id
      const assignType = assignMap.get(empId) ?? null
      const onDuty     = assignType ? ON_DUTY_TYPES.has(assignType) : false
      const leaveLabel = assignType ? LEAVE_LABELS[assignType] : undefined
      const onDebit    = debitTodaySet.has(empId)

      let eligible = false
      const exclusionLabels: string[] = []

      if (onDuty || onDebit) {
        // Already working this shift (regular/trade/callback or debit day)
        exclusionLabels.push('Working')
      } else if (leaveLabel) {
        // On approved leave
        exclusionLabels.push(leaveLabel)
      } else {
        // Off duty — for single-role classifications also check hour/day limits
        if (list.singleRole) {
          const prior  = priorOnDutyDays(empId)
          const streak = consecutiveDaysBefore(empId)

          if (prior * HOURS_PER_SHIFT >= MAX_HOURS_ROLLING) {
            exclusionLabels.push('72-hr limit')
          } else if (streak >= MAX_CONSEC_DAYS) {
            exclusionLabels.push('5-day limit')
          } else {
            eligible = true
          }
        } else {
          // Captain / Engineer / FF — off duty means eligible, no hour/day limits
          eligible = true
        }
      }

      const emp = m.employees as any
      return {
        id:               m.id,
        employeeId:       empId,
        name:             `${emp?.first_name ?? ''} ${emp?.last_name ?? ''}`.trim(),
        rank:             emp?.rank ?? '',
        shift:            emp?.shift_assignment ?? '',
        listPosition:     m.mandatory_rank,
        lastCallbackDate: m.last_mandatory_date,
        timesWorked:      m.times_mandatoried ?? 0,
        eligible,
        exclusionLabels,
      }
    })

    classifications.push({
      listType:      list.type,
      label:         list.label,
      members,
      eligibleCount: members.filter(m => m.eligible).length,
    })
  }

  return NextResponse.json({ shiftDate, fiscalYear: fy, classifications })
}
