import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { TABLES } from '@/lib/db/tables'
// ON_DUTY_TYPES now includes 'light_duty'. A member on light duty is at work
// and must not be offered or assigned mandatory overtime; the local copy this
// replaces omitted that type, so light-duty members showed as OT-available.
import { ON_DUTY_TYPES, leaveExclusionLabel } from '@/lib/schedule/assignment-types'
import { ELIGIBILITY_COLUMNS } from '@/lib/schedule/daily-assignment'
import { withUser } from '@/lib/auth/guard'
import { displayName } from '@/lib/employees/display'

// SFD Fiscal Year starts July 1
// July (JS month 6) onward → FY = next calendar year
function fiscalYear(date: Date): number {
  return date.getUTCMonth() >= 6 ? date.getUTCFullYear() + 1 : date.getUTCFullYear()
}



const MAND_LISTS = [
  { type: 'Captain_mand',               label: 'Captain' },
  { type: 'Engineer_mand',              label: 'Engineer (AO)' },
  { type: 'FF_mand',                    label: 'Firefighter' },
  { type: 'FF_Engineer_combined_mand',  label: 'FF / Engineer Medic Combined' },
  { type: 'SRE_mand',                   label: 'SRE' },
  { type: 'SRP_mand',                   label: 'SRP' },
]

export const GET = withUser<NextRequest>(async (req) => {
  const { searchParams } = new URL(req.url)
  const dateParam = searchParams.get('date')

  // Use noon UTC so timezone doesn't flip the date
  const targetDate = dateParam
    ? new Date(`${dateParam}T12:00:00Z`)
    : new Date()

  const shiftDate  = targetDate.toISOString().split('T')[0]
  const fy         = fiscalYear(targetDate)
  const supabase   = createAdminClient()

  // ── All assignments for this shift date ──────────────────────────────────
  const { data: assignments, error: assignErr } = await supabase
    .from(TABLES.dailyAssignments)
    .select(ELIGIBILITY_COLUMNS)
    .eq('shift_date', shiftDate)

  if (assignErr) {
    return NextResponse.json({ error: assignErr.message }, { status: 500 })
  }

  // employee_id → assignment_type  (on-duty wins over leave if multiple rows)
  const assignMap = new Map<number, string>()
  for (const a of (assignments ?? [])) {
    const existing = assignMap.get(a.employee_id)
    if (!existing || ON_DUTY_TYPES.has(a.assignment_type)) {
      assignMap.set(a.employee_id, a.assignment_type)
    }
  }

  // ── Build each classification ─────────────────────────────────────────────
  const classifications = []

  for (const list of MAND_LISTS) {
    const { data: rows, error: listErr } = await supabase
      .from(TABLES.otListPositions)
      .select(`
        id,
        employee_id,
        mandatory_rank,
        last_mandatory_date,
        times_mandatoried,
        employees (
          first_name,
          nickname,
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
      const assignType = assignMap.get(m.employee_id) ?? null
      const onDuty     = assignType ? ON_DUTY_TYPES.has(assignType) : false
      const leaveLabel = leaveExclusionLabel(assignType)

      let eligible = false
      const exclusionLabels: string[] = []

      if (!assignType) {
        exclusionLabels.push('Not on shift today')
      } else if (leaveLabel) {
        exclusionLabels.push(leaveLabel)
      } else if (onDuty) {
        eligible = true
      } else {
        exclusionLabels.push(assignType)
      }

      const emp = m.employees as any
      return {
        id:                m.id,
        employeeId:        m.employee_id,
        name:              emp ? displayName(emp) : '',
        rank:              emp?.rank ?? '',
        shift:             emp?.shift_assignment ?? '',
        listPosition:      m.mandatory_rank,
        lastMandatoryDate: m.last_mandatory_date,
        timesMandatoried:  m.times_mandatoried ?? 0,
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
})
