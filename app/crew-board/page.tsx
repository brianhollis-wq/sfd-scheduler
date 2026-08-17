import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import DateNavClient from './DateNavClient'

// ── Types ─────────────────────────────────────────────────────────────────────

type Apparatus = {
  id: string
  call_sign: string
  display_name: string
  type: string
  status: string
  fire_zone: string | null
  station_id: number | null
  min_staffing: number
  requires_paramedic: boolean
  fleet_number: string | null
  is_reserve: boolean
  stations: { id: number; name: string } | null
}

type Assignment = {
  apparatus_id: string
  employee_id: number
  assignment_type: string
  start_dt: string | null
  end_dt: string | null
  employees: {
    first_name: string
    last_name: string
    rank: string
    badge_number: string
    is_paramedic: boolean
    shift_assignment: string | null
  } | null
}

type DebitRow = {
  employee_name: string
  apparatus: string | null
  position: string | null
  shift_letter: string | null
}

type AppWithCrew = Apparatus & { crew: Assignment[]; computedUnstaffed: boolean; isAdmin: boolean }

// ── Static unit overrides ──────────────────────────────────────────────────────

const UNSTAFFED_UNITS = new Set([
  'B-5', 'T-5', 'BR-5', 'BR-3', 'HB-11', 'DECON-13', 'HM-13', 'BR-1', 'A-1',
  'HR-4', 'F-6', 'F-16', 'USAR-TRK', 'T-7', 'HB-7', 'BR-7',
])

const ADMIN_UNITS = new Set([
  'DFM-1', 'DFM-2', 'DFM-3', 'DFM-4', 'DFM-5',
  'EMS-DC', 'EMS-COORD', 'EMS-TRN',
  'TR-DC', 'TR-CPT1', 'TR-CPT2', 'TR-AO',
  'LD',
])

const RESERVE_UNITS = new Set([
  'E-13', 'E-17', 'E-15', 'E-14', 'BC-3', 'E-16', 'TR-11',
  'M-6', 'M-11', 'M-12', 'E-12', 'M-8', 'BC-1', 'A-7', 'B-15', 'R-4',
])

// ── Day-of-week restrictions ───────────────────────────────────────────────────
// Apparatus only shown on the listed days (0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat)
const DAY_RESTRICTED: Record<string, number[]> = {
  'REACH-1': [2, 3, 4, 5],  // Tue–Fri only
}

// ── Battalion config ───────────────────────────────────────────────────────────

const BATTALIONS: {
  name: string
  bc: string
  stations: number[]
}[] = [
  { name: 'North Battalion', bc: 'BC-2', stations: [2, 3, 5, 8, 10, 11] },
  { name: 'South Battalion', bc: 'BC-4', stations: [1, 4, 6, 7, 9] },
]

const TYPE_ORDER: Record<string, number> = {
  engine: 1, ladder: 2, medic: 3, rescue: 4,
  brush: 5, water: 6, hazmat: 7, battalion: 8, special: 9, reserve: 10,
}

function apparatusSort(a: AppWithCrew, b: AppWithCrew): number {
  const statusTier = (ap: AppWithCrew) => {
    if (ap.status === 'oos') return 3
    if (ap.is_reserve) return 2
    return 1
  }
  const st = statusTier(a) - statusTier(b)
  if (st !== 0) return st
  const ta = TYPE_ORDER[a.type] ?? 99
  const tb = TYPE_ORDER[b.type] ?? 99
  if (ta !== tb) return ta - tb
  return a.id.localeCompare(b.id, undefined, { numeric: true })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ON_DUTY_TYPES = new Set(['regular', 'callback_voluntary', 'callback_mandatory', 'peak_engine', 'trade', 'light_duty'])

/** Assignment types shown as interns — non-staffing, accountability only */
const INTERN_TYPES = new Set(['ccc_intern'])

const CREW_RANK_ORDER: Record<string, number> = {
  BC: 1, Senior_DFM: 2, DFM: 3, Captain: 4, FAO: 5,
  SRP: 6, SRE: 7, FF_PM: 8, FF: 9,
  Probationary_PM: 10, Probationary_FF: 11, Staff: 12,
}

const LEAVE_LABELS: Record<string, string> = {
  vacation:  'Vacation',
  sick:      'Sick Leave',
  FMLA:      'FMLA',
  OFLA:      'OFLA',
  PLO:       'PLO',
  injury:    'Injury Leave',
  kelly_day: 'Kelly Day',
  WOC:       'WOC',
  AIC:       'AIC',
  BUM:       'BUM',
}

const DUTY_LABELS: Record<string, string> = {
  regular:            'Regular',
  callback_voluntary: 'Callback VOL',
  callback_mandatory: 'Callback MAN',
  peak_engine:        'Peak Engine',
  trade:              'Trade',
  light_duty:         'Light Duty',
}

function fmtTime(dt: string | null): string {
  if (!dt) return '????'
  return new Date(dt).toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).replace(':', '')
}

function isFullShift(start: string | null, end: string | null): boolean {
  if (!start || !end) return false
  const diffHrs = (new Date(end).getTime() - new Date(start).getTime()) / 36e5
  return Math.abs(diffHrs - 24) < 0.1
}

function crewSort(a: Assignment, b: Assignment): number {
  const ra = CREW_RANK_ORDER[a.employees?.rank ?? ''] ?? 99
  const rb = CREW_RANK_ORDER[b.employees?.rank ?? ''] ?? 99
  if (ra !== rb) return ra - rb
  return (a.employees?.last_name ?? '').localeCompare(b.employees?.last_name ?? '')
}

function getStatusColor(app: AppWithCrew): 'green' | 'amber' | 'red' | 'gray' | 'blue' {
  if (app.isAdmin) return 'gray'
  if (app.computedUnstaffed) return 'blue'
  if (app.is_reserve) return 'gray'
  if (app.status === 'oos') return 'red'
  const crewCount = app.crew.filter((a) => ON_DUTY_TYPES.has(a.assignment_type)).length
  if (crewCount < app.min_staffing) return 'amber'
  return 'green'
}

function formatRank(rank: string): string {
  const map: Record<string, string> = {
    Probationary_FF: 'PROB',
    Probationary_PM: 'PROB/PM',
    FF:              'FF',
    FF_PM:           'PM/FF',
    FAO:             'FAO',
    Captain:         'CAPT',
    BC:              'BC',
    DFM:             'DFM',
    Senior_DFM:      'SR DFM',
    Staff:           'STAFF',
    SRE:             'SRE',
    SRP:             'SRP',
    CCC_Intern:      'INTERN',
  }
  return map[rank] ?? rank.toUpperCase()
}

// ── Status dot ─────────────────────────────────────────────────────────────────

function StatusDot({ color }: { color: 'green' | 'amber' | 'red' | 'gray' | 'blue' }) {
  const cls = {
    green: 'bg-green-500',
    amber: 'bg-amber-400 animate-pulse',
    red:   'bg-red-600',
    gray:  'bg-zinc-500',
    blue:  'bg-sky-500',
  }[color]
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${cls}`} />
}

// ── Apparatus card ─────────────────────────────────────────────────────────────

function ApparatusCard({ app, compact }: { app: AppWithCrew; compact?: boolean }) {
  const color = getStatusColor(app)
  const onDutyCrew = app.crew.filter((a) => ON_DUTY_TYPES.has(a.assignment_type))
  const internCrew = app.crew.filter((a) => INTERN_TYPES.has(a.assignment_type))
  const crewCount = onDutyCrew.length
  const short = !app.isAdmin && !app.is_reserve && !app.computedUnstaffed && crewCount < app.min_staffing && app.status !== 'oos'
  const spotsNeeded = Math.max(0, app.min_staffing - crewCount)

  const borderColor = {
    green: 'border-green-600/40',
    amber: 'border-amber-400/60',
    red:   'border-red-600/60',
    gray:  'border-zinc-600/40',
    blue:  'border-sky-700/40',
  }[color]

  const headerBg = {
    green: 'bg-green-900/30',
    amber: 'bg-amber-900/30',
    red:   'bg-red-900/30',
    gray:  'bg-zinc-800/30',
    blue:  'bg-sky-900/20',
  }[color]

  return (
    <div className={`border ${borderColor} rounded-lg overflow-hidden bg-[#0d1b2a]`}>
      <div className={`${headerBg} px-3 py-2 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <StatusDot color={color} />
          <span className="font-mono font-bold text-white tracking-widest text-sm">{app.id}</span>
          {app.fleet_number && (
            <span className="text-zinc-400 font-mono text-xs">#{app.fleet_number}</span>
          )}
          {app.is_reserve && (
            <span className="text-[9px] font-mono font-bold text-zinc-500 tracking-widest">RSV</span>
          )}
        </div>
        <span className={`text-xs font-mono font-bold tabular-nums ${short ? 'text-amber-400' : compact ? 'text-zinc-400' : 'text-green-400'}`}>
          {crewCount}/{app.min_staffing}
        </span>
      </div>

      <div className="px-3 py-2 min-h-[52px]">
        {app.isAdmin && onDutyCrew.length === 0 ? (
          <div className="text-zinc-600 text-xs font-mono italic">ADMIN — 40 HR STAFF</div>
        ) : app.computedUnstaffed ? (
          <div className="text-sky-600/70 text-xs font-mono italic">IN SERVICE — UNSTAFFED</div>
        ) : app.is_reserve && onDutyCrew.length === 0 ? (
          <div className="text-zinc-600 text-xs font-mono italic">RESERVE — UNSTAFFED</div>
        ) : app.status === 'oos' ? (
          <div className="text-red-500/70 text-xs font-mono italic">OUT OF SERVICE</div>
        ) : onDutyCrew.length === 0 ? (
          <div className="text-zinc-600 text-xs font-mono italic">NO CREW ASSIGNED</div>
        ) : (
          <ul className="space-y-1">
            {[...onDutyCrew].sort(crewSort).map((a) => {
              const full = isFullShift(a.start_dt, a.end_dt)
              const timeStr = `${fmtTime(a.start_dt)}–${fmtTime(a.end_dt)}`
              return (
                <li key={a.employee_id} className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-[#c9a84c] w-14 shrink-0">
                    {a.employees ? formatRank(a.employees.rank) : '—'}
                  </span>
                  <span className="text-zinc-200 flex-1">
                    {a.employees
                      ? `${a.employees.last_name}, ${a.employees.first_name.charAt(0)}.`
                      : '—'}
                  </span>
                  {a.employees?.is_paramedic && (
                    <span className="text-blue-400 text-[9px] font-bold tracking-widest">PM</span>
                  )}
                  <span className={`text-[9px] font-mono tabular-nums shrink-0 ${full ? 'text-zinc-400' : 'text-amber-400 font-bold'}`}>
                    {timeStr}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {short && !app.computedUnstaffed && (
          <ul className="space-y-1 mt-1">
            {Array.from({ length: spotsNeeded }).map((_, i) => (
              <li key={i} className="text-xs font-mono text-amber-500/70 flex items-center gap-1">
                <span className="w-14 shrink-0">OPEN</span>
                <span className="text-amber-600/50">▸ vacancy</span>
              </li>
            ))}
          </ul>
        )}

        {/* CCC Interns — accountability only, does not count toward staffing */}
        {internCrew.length > 0 && (
          <div className="mt-2 pt-2 border-t border-zinc-700/40">
            <ul className="space-y-1">
              {internCrew.map((a) => (
                <li key={a.employee_id} className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-purple-400/80 w-14 shrink-0">INTERN</span>
                  <span className="text-zinc-400 flex-1">
                    {a.employees
                      ? `${a.employees.last_name}, ${a.employees.first_name.charAt(0)}.`
                      : '—'}
                  </span>
                  <span className="text-[9px] font-mono font-bold text-purple-500/70 tracking-widest">CCC</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Station section ────────────────────────────────────────────────────────────

function StationSection({ stationId, stationName, apps }: {
  stationId: number
  stationName: string
  apps: AppWithCrew[]
}) {
  const shortCount = apps.filter((a) => {
    if (a.status === 'oos' || a.is_reserve || a.computedUnstaffed || a.isAdmin) return false
    const crew = a.crew.filter((c) => ON_DUTY_TYPES.has(c.assignment_type)).length
    return crew < a.min_staffing
  }).length

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 mt-4 first:mt-0">
        <div className="text-[10px] font-mono font-bold tracking-[0.18em] text-zinc-500 uppercase">
          STA {stationId} — {stationName.replace(/^Station \d+\s*[-–]?\s*/i, '').trim() || stationName}
        </div>
        {shortCount > 0 && (
          <span className="text-[9px] font-mono font-bold text-amber-400">▲ {shortCount} SHORT</span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {apps.sort(apparatusSort).map((app) => (
          <ApparatusCard key={app.id} app={app} />
        ))}
      </div>
    </div>
  )
}

// ── Battalion section ──────────────────────────────────────────────────────────

function BattalionSection({ name, bcApp, stationGroups }: {
  name: string
  bcApp: AppWithCrew | undefined
  stationGroups: { id: number; name: string; apps: AppWithCrew[] }[]
}) {
  const allApps = stationGroups.flatMap((s) => s.apps)
  const engines = allApps.filter((a) => a.type === 'engine' && a.status !== 'oos' && !a.is_reserve && !a.computedUnstaffed && !a.isAdmin)
  const shortUnits = allApps.filter((a) => {
    if (a.status === 'oos' || a.is_reserve || a.computedUnstaffed || a.isAdmin) return false
    const crew = a.crew.filter((c) => ON_DUTY_TYPES.has(c.assignment_type)).length
    return crew < a.min_staffing
  })

  const isNorth = name.toLowerCase().includes('north')
  const accentColor  = isNorth ? 'text-sky-400'        : 'text-orange-400'
  const accentBorder = isNorth ? 'border-sky-700/40'   : 'border-orange-700/40'
  const accentBg     = isNorth ? 'bg-sky-900/20'       : 'bg-orange-900/20'

  return (
    <div className={`border ${accentBorder} rounded-xl overflow-hidden`}>
      <div className={`${accentBg} border-b ${accentBorder} px-4 py-3 flex items-center justify-between flex-wrap gap-2`}>
        <div className="flex items-center gap-3">
          <h2 className={`text-sm font-mono font-bold tracking-[0.15em] ${accentColor} uppercase`}>{name}</h2>
          <div className="flex items-center gap-1.5">
            <StatusDot color={engines.length >= 1 ? 'green' : 'red'} />
            <span className={`text-[10px] font-mono font-bold ${engines.length >= 1 ? 'text-green-400' : 'text-red-400'}`}>
              {engines.length} ENGINE{engines.length !== 1 ? 'S' : ''} IN SERVICE
            </span>
          </div>
          {shortUnits.length > 0 && (
            <span className="text-[10px] font-mono font-bold text-amber-400">
              · {shortUnits.length} UNIT{shortUnits.length !== 1 ? 'S' : ''} SHORT
            </span>
          )}
        </div>
      </div>

      <div className="px-4 py-3 space-y-4 bg-[#091520]">
        {bcApp && (
          <div>
            <div className="text-[10px] font-mono font-bold tracking-[0.18em] text-zinc-500 uppercase mb-2">
              BATTALION COMMAND
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              <ApparatusCard app={bcApp} />
            </div>
          </div>
        )}
        {stationGroups.map((sg) =>
          sg.apps.length > 0 ? (
            <StationSection key={sg.id} stationId={sg.id} stationName={sg.name} apps={sg.apps} />
          ) : null
        )}
      </div>
    </div>
  )
}

// ── Personnel view ─────────────────────────────────────────────────────────────

function PersonnelView({ assignments, debitRows }: {
  assignments: Assignment[]
  debitRows:   DebitRow[]
}) {
  const onDuty = assignments
    .filter(a => ON_DUTY_TYPES.has(a.assignment_type) && a.employees)
    .sort((a, b) => {
      const ra = CREW_RANK_ORDER[a.employees?.rank ?? ''] ?? 99
      const rb = CREW_RANK_ORDER[b.employees?.rank ?? ''] ?? 99
      if (ra !== rb) return ra - rb
      return (a.employees?.last_name ?? '').localeCompare(b.employees?.last_name ?? '')
    })

  const onLeave = assignments
    .filter(a => !ON_DUTY_TYPES.has(a.assignment_type) && a.employees)
    .sort((a, b) => {
      if (a.assignment_type !== b.assignment_type) return a.assignment_type.localeCompare(b.assignment_type)
      return (a.employees?.last_name ?? '').localeCompare(b.employees?.last_name ?? '')
    })

  const th = 'text-left text-[10px] font-mono font-bold tracking-[0.15em] text-zinc-500 uppercase pb-2 pr-6'
  const td = 'text-xs font-mono py-2 pr-6 border-t border-zinc-800/50'

  return (
    <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-5">

      {/* On Duty */}
      <div className="border border-green-600/30 rounded-xl overflow-hidden">
        <div className="bg-green-900/20 border-b border-green-600/30 px-5 py-3 flex items-center gap-3">
          <StatusDot color="green" />
          <span className="font-mono font-bold text-sm text-green-400 tracking-widest uppercase">On Duty</span>
          <span className="font-mono text-xs text-zinc-500">{onDuty.length} personnel</span>
        </div>
        <div className="bg-[#091520] px-5 py-3 overflow-x-auto">
          {onDuty.length === 0 ? (
            <p className="text-zinc-600 font-mono text-xs italic py-2">No on-duty personnel recorded for this date</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Rank</th>
                  <th className={th}>Apparatus</th>
                  <th className={th}>Type</th>
                  <th className={th}>Shift</th>
                  <th className={th}>PM</th>
                </tr>
              </thead>
              <tbody>
                {onDuty.map((a, i) => (
                  <tr key={`${a.employee_id}-${i}`} className="hover:bg-zinc-900/40">
                    <td className={`${td} text-zinc-200 font-semibold`}>
                      {a.employees!.last_name}, {a.employees!.first_name.charAt(0)}.
                    </td>
                    <td className={`${td} text-[#c9a84c]`}>{formatRank(a.employees!.rank)}</td>
                    <td className={`${td} text-zinc-300 font-mono tracking-widest`}>{a.apparatus_id || '—'}</td>
                    <td className={`${td} text-zinc-400`}>{DUTY_LABELS[a.assignment_type] ?? a.assignment_type}</td>
                    <td className={`${td} text-zinc-500`}>{a.employees!.shift_assignment ?? '—'}</td>
                    <td className={td}>
                      {a.employees!.is_paramedic && (
                        <span className="text-blue-400 text-[10px] font-bold tracking-widest">PM</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* On Leave */}
      <div className="border border-amber-600/30 rounded-xl overflow-hidden">
        <div className="bg-amber-900/20 border-b border-amber-600/30 px-5 py-3 flex items-center gap-3">
          <StatusDot color="amber" />
          <span className="font-mono font-bold text-sm text-amber-400 tracking-widest uppercase">On Leave</span>
          <span className="font-mono text-xs text-zinc-500">{onLeave.length} personnel</span>
        </div>
        <div className="bg-[#091520] px-5 py-3 overflow-x-auto">
          {onLeave.length === 0 ? (
            <p className="text-zinc-600 font-mono text-xs italic py-2">No leave recorded for this date</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Rank</th>
                  <th className={th}>Leave Type</th>
                  <th className={th}>Shift</th>
                </tr>
              </thead>
              <tbody>
                {onLeave.map((a, i) => (
                  <tr key={`${a.employee_id}-${i}`} className="hover:bg-zinc-900/40">
                    <td className={`${td} text-zinc-200 font-semibold`}>
                      {a.employees!.last_name}, {a.employees!.first_name.charAt(0)}.
                    </td>
                    <td className={`${td} text-[#c9a84c]`}>{formatRank(a.employees!.rank)}</td>
                    <td className={`${td} text-amber-300/80`}>
                      {LEAVE_LABELS[a.assignment_type] ?? a.assignment_type}
                    </td>
                    <td className={`${td} text-zinc-500`}>{a.employees!.shift_assignment ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Debit Day */}
      <div className="border border-sky-700/30 rounded-xl overflow-hidden">
        <div className="bg-sky-900/20 border-b border-sky-700/30 px-5 py-3 flex items-center gap-3">
          <StatusDot color="blue" />
          <span className="font-mono font-bold text-sm text-sky-400 tracking-widest uppercase">Debit Day</span>
          <span className="font-mono text-xs text-zinc-500">{debitRows.length} personnel</span>
        </div>
        <div className="bg-[#091520] px-5 py-3 overflow-x-auto">
          {debitRows.length === 0 ? (
            <p className="text-zinc-600 font-mono text-xs italic py-2">No debit day workers scheduled</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Apparatus</th>
                  <th className={th}>Position</th>
                  <th className={th}>Shift</th>
                </tr>
              </thead>
              <tbody>
                {debitRows.map((d, i) => (
                  <tr key={i} className="hover:bg-zinc-900/40">
                    <td className={`${td} text-zinc-200 font-semibold`}>{d.employee_name}</td>
                    <td className={`${td} text-zinc-300 font-mono tracking-widest`}>{d.apparatus ?? '—'}</td>
                    <td className={`${td} text-zinc-400`}>{d.position ?? '—'}</td>
                    <td className={`${td} text-zinc-500`}>{d.shift_letter ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// Force dynamic rendering
export const dynamic = 'force-dynamic'

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function StaffingBoard({
  searchParams,
}: {
  searchParams: { date?: string; tab?: string }
}) {
  const supabase = createAdminClient()

  // Determine shift date (SFD shifts start 08:00 PDT = 15:00 UTC)
  const _utcNow = new Date()
  const _boundary = new Date(_utcNow)
  _boundary.setUTCHours(15, 0, 0, 0)
  const today = (_utcNow < _boundary
    ? new Date(_utcNow.getTime() - 24 * 60 * 60 * 1000)
    : _utcNow
  ).toISOString().slice(0, 10)

  const selectedDate = searchParams?.date ?? today
  const activeTab    = searchParams?.tab  ?? 'apparatus'

  // Load apparatus
  const { data: apparatus, error: apErr } = await supabase
    .from('apparatus')
    .select('*, stations(id, name)')
    .order('id')

  if (apErr) return <ErrorScreen err={apErr} />

  // Load assignments for selected date — updated to include shift_assignment
  let shiftDate   = selectedDate
  let assignments: Assignment[] = []

  const { data: dateData, error: asErr } = await supabase
    .from('daily_assignments')
    .select(
      'apparatus_id, employee_id, assignment_type, start_dt, end_dt, employees(first_name, last_name, rank, badge_number, is_paramedic, shift_assignment)'
    )
    .eq('shift_date', selectedDate)

  if (asErr) return <ErrorScreen err={asErr} />

  if (dateData && dateData.length > 0) {
    assignments = dateData as Assignment[]
  } else if (selectedDate === today) {
    // Only fall back to most recent date when viewing today with no data
    const { data: latest } = await supabase
      .from('daily_assignments')
      .select('shift_date')
      .order('shift_date', { ascending: false })
      .limit(1)
      .single()

    if (latest?.shift_date) {
      shiftDate = latest.shift_date
      const { data: fallbackData } = await supabase
        .from('daily_assignments')
        .select(
          'apparatus_id, employee_id, assignment_type, start_dt, end_dt, employees(first_name, last_name, rank, badge_number, is_paramedic, shift_assignment)'
        )
        .eq('shift_date', shiftDate)
      assignments = (fallbackData ?? []) as Assignment[]
    }
  }

  const isStale = shiftDate !== selectedDate

  // Load debit day workers for selected date
  const { data: debitRows } = await supabase
    .from('debit_days')
    .select('employee_name, apparatus, position, shift_letter')
    .eq('debit_date', shiftDate)
    .eq('status', 'scheduled')
    .order('employee_name')

  // Load shift letter
  const { data: rotationRow } = await supabase
    .from('shift_rotation')
    .select('shift_letter')
    .eq('shift_date', shiftDate)
    .single()
  const shiftLetter: string | null = rotationRow?.shift_letter ?? null

  // Day-of-week for schedule date (used to filter day-restricted apparatus)
  const shiftDow = new Date(shiftDate + 'T12:00:00').getDay()

  // Build apparatus with crew
  const apps: AppWithCrew[] = (apparatus ?? []).filter((ap) => {
    const allowed = DAY_RESTRICTED[ap.id]
    return !allowed || allowed.includes(shiftDow)
  }).map((ap) => ({
    ...ap,
    is_reserve:        RESERVE_UNITS.has(ap.id) ? true : ap.is_reserve,
    computedUnstaffed: UNSTAFFED_UNITS.has(ap.id),
    isAdmin:           ADMIN_UNITS.has(ap.id),
    crew: assignments.filter((a) => a.apparatus_id === ap.id),
  }))

  // Summary metrics
  const onDutyTotal = assignments.filter((a) => ON_DUTY_TYPES.has(a.assignment_type)).length
  const MIN_STAFFING = 41
  const staffingOk = onDutyTotal >= MIN_STAFFING

  const activeApps = apps.filter((a) => a.status !== 'oos' && !a.is_reserve && !a.computedUnstaffed && !a.isAdmin)
  const shortUnits = activeApps.filter((a) => {
    const crew = a.crew.filter((c) => ON_DUTY_TYPES.has(c.assignment_type)).length
    return crew < a.min_staffing
  })
  const oosUnits = apps.filter((a) => a.status === 'oos' && !a.is_reserve && !a.computedUnstaffed && !a.isAdmin)

  // Battalion layout
  const accountedIds = new Set<string>()
  const battalionData = BATTALIONS.map((bat) => {
    const bcApp = apps.find((a) => a.id === bat.bc)
    if (bcApp) accountedIds.add(bcApp.id)
    const stationGroups = bat.stations.map((sid) => {
      const stationApps = apps.filter((a) => a.station_id === sid && a.id !== bat.bc)
      stationApps.forEach((a) => accountedIds.add(a.id))
      const stationName = stationApps[0]?.stations?.name ?? `Station ${sid}`
      return { id: sid, name: stationName, apps: stationApps }
    })
    return { ...bat, bcApp, stationGroups }
  })

  // Weekday check: admin 40-hr staff appear Mon–Fri even without crew data
  const isWeekday = new Date(shiftDate + 'T12:00:00').getDay() % 6 !== 0

  const unclaimed = apps.filter((a) => {
    if (!accountedIds.has(a.id)) {
      if (a.isAdmin) {
        const hasCrew = a.crew.filter((c) => ON_DUTY_TYPES.has(c.assignment_type)).length > 0
        return hasCrew || isWeekday
      }
      return true
    }
    return false
  })

  const now = new Date().toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  const shiftDateDisplay = new Date(shiftDate + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  return (
    <main className="min-h-screen bg-[#091520] text-white">

      {/* ── Header ── */}
      <header className="border-b border-[#c9a84c]/30 bg-[#0a1a28] px-6 py-4">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <div>
              <div className="text-[10px] font-mono font-bold tracking-[0.25em] text-[#c9a84c] uppercase">
                Salem Fire Department
              </div>
              <div className="text-xl font-mono font-bold tracking-wider text-white">
                CREW SCHEDULER
              </div>
            </div>
            {shiftLetter && (
              <div className="flex flex-col items-center justify-center border border-[#c9a84c]/40 rounded-lg px-4 py-1.5 bg-[#c9a84c]/10">
                <div className="text-[9px] font-mono font-bold tracking-[0.2em] text-[#c9a84c]/70 uppercase">Shift</div>
                <div className="text-3xl font-mono font-bold leading-none text-[#c9a84c]">{shiftLetter}</div>
              </div>
            )}
          </div>

          {/* Nav links */}
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="text-[10px] font-mono tracking-widest uppercase border border-zinc-700/60
                text-zinc-400 hover:text-white hover:border-zinc-500 rounded px-3 py-1.5 transition-colors"
            >
              ← Home
            </Link>
            <Link
              href="/mot"
              className="text-[10px] font-mono tracking-widest uppercase border border-zinc-700/60
                text-zinc-400 hover:text-white hover:border-zinc-500 rounded px-3 py-1.5 transition-colors"
            >
              MOT Board ▸
            </Link>
            <Link
              href="/import"
              className="text-[10px] font-mono tracking-widest uppercase border border-zinc-700/60
                text-zinc-400 hover:text-white hover:border-zinc-500 rounded px-3 py-1.5 transition-colors"
            >
              Import PDF ▸
            </Link>
          </div>

          {/* Summary metrics */}
          <div className="flex items-center gap-6 flex-wrap">
            <div className="text-center">
              <div className="text-[9px] font-mono font-bold tracking-[0.2em] text-zinc-500 uppercase">On Duty</div>
              <div className={`text-2xl font-mono font-bold tabular-nums leading-none ${staffingOk ? 'text-green-400' : 'text-red-400'}`}>
                {onDutyTotal}
              </div>
              <div className="text-[9px] font-mono text-zinc-500">MIN {MIN_STAFFING}</div>
            </div>
            <div className="w-px h-10 bg-zinc-700" />
            <div className="text-center">
              <div className="text-[9px] font-mono font-bold tracking-[0.2em] text-zinc-500 uppercase">Short</div>
              <div className={`text-2xl font-mono font-bold tabular-nums leading-none ${shortUnits.length > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                {shortUnits.length}
              </div>
              <div className="text-[9px] font-mono text-zinc-500">UNITS</div>
            </div>
            <div className="w-px h-10 bg-zinc-700" />
            <div className="text-center">
              <div className="text-[9px] font-mono font-bold tracking-[0.2em] text-zinc-500 uppercase">OOS</div>
              <div className={`text-2xl font-mono font-bold tabular-nums leading-none ${oosUnits.length > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {oosUnits.length}
              </div>
              <div className="text-[9px] font-mono text-zinc-500">UNITS</div>
            </div>
            <div className="w-px h-10 bg-zinc-700" />
            <div className="text-right">
              <div className="text-[9px] font-mono font-bold tracking-[0.2em] text-zinc-500 uppercase">
                {isStale ? 'Last Data' : 'Updated'}
              </div>
              <div className={`text-sm font-mono ${isStale ? 'text-amber-400' : 'text-zinc-300'}`}>
                {isStale ? shiftDateDisplay : now}
              </div>
              <div className="text-[9px] font-mono">
                {isStale
                  ? <span className="text-amber-400">⚠ NO DATA — import today&apos;s schedule</span>
                  : staffingOk
                    ? <span className="text-green-400">● MIN STAFFING MET</span>
                    : <span className="text-red-400 animate-pulse">● BELOW MINIMUM</span>}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── Date nav + tab switcher (client component) ── */}
      <DateNavClient selectedDate={shiftDate} activeTab={activeTab} />

      {/* ── Legend (apparatus view only) ── */}
      {activeTab !== 'personnel' && (
        <div className="border-b border-zinc-800 bg-[#0a1a28]/50 px-6 py-2">
          <div className="max-w-screen-2xl mx-auto flex items-center gap-6 text-[10px] font-mono text-zinc-500">
            <span className="flex items-center gap-1.5"><StatusDot color="green" /> FULLY STAFFED</span>
            <span className="flex items-center gap-1.5"><StatusDot color="amber" /> SHORT-STAFFED</span>
            <span className="flex items-center gap-1.5"><StatusDot color="red" /> OUT OF SERVICE</span>
            <span className="flex items-center gap-1.5"><StatusDot color="gray" /> RESERVE / ADMIN</span>
            <span className="flex items-center gap-1.5"><StatusDot color="blue" /> IN SERVICE — UNSTAFFED</span>
          </div>
        </div>
      )}

      {/* ── Tab content ── */}
      {activeTab === 'personnel' ? (
        <PersonnelView
          assignments={assignments}
          debitRows={(debitRows ?? []) as DebitRow[]}
        />
      ) : (
        <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">
          {battalionData.map((bat) => (
            <BattalionSection
              key={bat.name}
              name={bat.name}
              bcApp={bat.bcApp}
              stationGroups={bat.stationGroups}
            />
          ))}

          {unclaimed.length > 0 && (
            <div>
              <div className="text-[10px] font-mono font-bold tracking-[0.2em] text-zinc-500 uppercase mb-3">
                Administrative / Specialty
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {unclaimed.sort(apparatusSort).map((app) => (
                  <ApparatusCard key={app.id} app={app} />
                ))}
              </div>
            </div>
          )}

          {apps.length === 0 && (
            <div className="text-center py-24">
              <div className="text-zinc-600 font-mono text-sm mb-2">NO APPARATUS DATA</div>
            </div>
          )}
        </div>
      )}
    </main>
  )
}

// ── Error screen ──────────────────────────────────────────────────────────────

function ErrorScreen({ err }: { err: { message?: string; code?: string; details?: string; hint?: string } }) {
  return (
    <main className="min-h-screen bg-[#091520] text-white flex items-center justify-center p-8">
      <div className="font-mono text-sm max-w-2xl w-full space-y-2">
        <div className="text-red-400 font-bold text-base mb-4">SUPABASE QUERY ERROR</div>
        <div><span className="text-zinc-500">message: </span><span className="text-amber-300">{err?.message ?? '(none)'}</span></div>
        <div><span className="text-zinc-500">code:    </span><span className="text-amber-300">{err?.code ?? '(none)'}</span></div>
        <div><span className="text-zinc-500">details: </span><span className="text-amber-300">{err?.details ?? '(none)'}</span></div>
        <div><span className="text-zinc-500">hint:    </span><span className="text-amber-300">{err?.hint ?? '(none)'}</span></div>
        <div className="mt-4 text-zinc-600 text-xs">
          Check NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env.local
        </div>
      </div>
    </main>
  )
}
