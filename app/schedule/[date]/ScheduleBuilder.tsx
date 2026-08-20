'use client'

/**
 * ScheduleBuilder — crew-board-style UI with inline editing.
 * Matches the visual design of /crew-board but adds:
 *   - OFF button per crew row (opens leave-type menu)
 *   - ⇄ swap button per crew row (opens employee search modal)
 *   - + OT slot per apparatus card
 *   - Publish button writes to daily_assignments
 */

import { useState, useCallback, useTransition } from 'react'
import Link from 'next/link'
import {
  ON_DUTY_TYPES,
  countsForStaffing,
  LEAVE_TYPE_OPTIONS,
  ASSIGNABLE_TYPE_OPTIONS,
  assignmentLabel,
} from '@/lib/schedule/assignment-types'
import { apparatusCountsTowardMinimum } from '@/lib/schedule/apparatus'
import { rankLabel } from '@/lib/employees/rank'
import { assessStaffing } from '@/lib/schedule/staffing'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EmployeeOption {
  id: number
  first_name: string
  last_name: string
  rank: string
  badge_number: string
  is_paramedic: boolean
  shift_assignment: string | null
}

export interface RosterPosition {
  id: number
  position: string
  sort_order: number
  note: string | null
  assignmentType: string   // 'regular' | 'callback_voluntary' | 'callback_mandatory' | 'trade' | etc.
  employee: EmployeeOption | null
}

export interface ApparatusRoster {
  apparatus_id: string
  call_sign: string
  type: string
  station_id: number | null
  station_name: string | null
  min_staffing: number
  positions: RosterPosition[]
}

interface EditablePosition {
  key: string
  rosterId: number
  apparatusId: string
  position: string
  sort_order: number
  note: string | null
  employee: EmployeeOption | null
  assignmentType: string
  isModified: boolean
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BATTALIONS = [
  { name: 'North Battalion', bc: 'BC-2', stations: [2, 3, 5, 8, 10, 11] },
  { name: 'South Battalion', bc: 'BC-4', stations: [1, 4, 6, 7, 9] },
]

// Assignment vocabulary is shared with the crew board, the eligibility APIs and
// the publish route — see lib/schedule/assignment-types.ts. The local copy this
// replaces was missing 'light_duty', so a light-duty member loaded into the
// builder read as absent and was struck through.
const LEAVE_TYPES    = LEAVE_TYPE_OPTIONS
const CALLBACK_TYPES = ASSIGNABLE_TYPE_OPTIONS

const TYPE_ORDER: Record<string, number> = {
  bc: 0, engine: 1, truck: 2, medic: 3, rescue: 4, brush: 5, utility: 6,
}

const SHIFT_BADGE: Record<string, string> = {
  A: 'text-red-300   border-red-600/50   bg-red-900/20',
  B: 'text-blue-300  border-blue-600/50  bg-blue-900/20',
  C: 'text-green-300 border-green-600/50 bg-green-900/20',
  D: 'text-amber-300 border-amber-600/50 bg-amber-900/20',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function posKey(p: EditablePosition) { return p.key }

const leaveLabel    = assignmentLabel
const callbackLabel = assignmentLabel

// ── Status Dot ────────────────────────────────────────────────────────────────

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

// ── Employee Search Modal ─────────────────────────────────────────────────────

function EmployeeSearchModal({
  onSelect, onClose,
}: {
  onSelect: (emp: EmployeeOption | null, assignmentType: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(false)
  const [assignmentType, setAssignmentType] = useState('callback_voluntary')

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/employees/search?q=${encodeURIComponent(q)}&limit=20`)
      if (res.ok) setResults(((await res.json()) as { employees: EmployeeOption[] }).employees ?? [])
    } finally { setLoading(false) }
  }, [])

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-neutral-700 flex items-center justify-between">
          <span className="font-mono font-bold text-sm text-neutral-200 tracking-widest uppercase">Assign Employee</span>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 text-lg">✕</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <p className="text-[10px] font-mono font-bold text-neutral-500 tracking-widest uppercase mb-1.5">Assignment Type</p>
            <div className="grid grid-cols-2 gap-1.5">
              {CALLBACK_TYPES.map(t => (
                <button key={t.value} onClick={() => setAssignmentType(t.value)}
                  className={`text-xs font-mono py-1.5 px-3 rounded border transition-colors ${
                    assignmentType === t.value
                      ? 'border-sky-500 bg-sky-900/40 text-sky-300'
                      : 'border-neutral-700 bg-neutral-900/40 text-neutral-400 hover:border-neutral-500'
                  }`}>{t.label}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-mono font-bold text-neutral-500 tracking-widest uppercase mb-1.5">Search Employee</p>
            <input autoFocus type="text" value={query}
              onChange={e => { setQuery(e.target.value); void search(e.target.value) }}
              placeholder="Last name or first name…"
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm font-mono text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-sky-500"
            />
          </div>
          <div className="max-h-56 overflow-y-auto space-y-1">
            {loading && <p className="text-xs font-mono text-neutral-500 py-2 text-center">Searching…</p>}
            {!loading && query.length >= 2 && results.length === 0 && (
              <p className="text-xs font-mono text-neutral-600 py-2 text-center">No results</p>
            )}
            {results.map(emp => (
              <button key={emp.id} onClick={() => onSelect(emp, assignmentType)}
                className="w-full text-left px-3 py-2 rounded bg-neutral-800/50 hover:bg-neutral-700 border border-transparent hover:border-neutral-600 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="text-[#c9a84c] text-xs font-mono w-14 shrink-0">{rankLabel(emp.rank)}</span>
                  <span className="text-neutral-200 text-xs font-mono flex-1">{emp.last_name}, {emp.first_name}</span>
                  {emp.is_paramedic && <span className="text-blue-400 text-[9px] font-bold">PM</span>}
                  <span className="text-neutral-600 text-[10px] font-mono">{emp.shift_assignment}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Leave Menu ────────────────────────────────────────────────────────────────

function LeaveMenu({ onSelect, onClose }: { onSelect: (t: string) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-56 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-neutral-700">
          <p className="font-mono font-bold text-xs text-neutral-400 tracking-widest uppercase">Mark Absent As</p>
        </div>
        <div className="py-1">
          {LEAVE_TYPES.map(t => (
            <button key={t.value} onClick={() => onSelect(t.value)}
              className="w-full text-left px-4 py-2 text-xs font-mono text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors">
              {t.label}
            </button>
          ))}
          <div className="border-t border-neutral-700/50 mt-1 pt-1">
            <button onClick={onClose} className="w-full text-left px-4 py-2 text-xs font-mono text-neutral-600 hover:text-neutral-400">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Apparatus Card ────────────────────────────────────────────────────────────

function ApparatusCard({
  app, positions, onUpdate, onAddOT,
}: {
  app: ApparatusRoster
  positions: EditablePosition[]
  onUpdate: (key: string, updates: Partial<EditablePosition>) => void
  onAddOT: (apparatusId: string) => void
}) {
  const [leaveKey, setLeaveKey] = useState<string | null>(null)
  const [swapKey, setSwapKey]   = useState<string | null>(null)

  // Judged by seat, matching the crew board: an engine needs a captain, an
  // operator and a firefighter; a medic a paramedic and an EMT. Light-duty
  // members and interns stay listed but fill nothing — see countsForStaffing.
  const staffing = assessStaffing(
    app.type,
    positions.map(p => ({ rank: p.employee?.rank, assignmentType: p.employee ? p.assignmentType : 'vacant', isParamedic: p.employee?.is_paramedic })),
    app.min_staffing,
  )
  const onDutyCount = staffing.staffingCount
  const isShort = apparatusCountsTowardMinimum(app.apparatus_id) && staffing.isShort

  const color: 'green' | 'amber' = isShort ? 'amber' : 'green'

  const borderColor = { green: 'border-green-600/40', amber: 'border-amber-400/60' }[color]
  const headerBg    = { green: 'bg-green-900/30',     amber: 'bg-amber-900/30'     }[color]

  return (
    <div className={`border ${borderColor} rounded-lg overflow-hidden bg-[#0d1b2a]`}>
      {/* Card header */}
      <div className={`${headerBg} px-3 py-2 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <StatusDot color={color} />
          <span className="font-mono font-bold text-white tracking-widest text-sm">{app.apparatus_id}</span>
        </div>
        <div className="flex items-center gap-2">
          {isShort && staffing.openSeats.length > 0 && (
            <span className="text-[9px] font-mono font-bold text-amber-400/80 tracking-widest">
              {staffing.openSeats.join(' ')}
            </span>
          )}
          <span className={`text-xs font-mono font-bold tabular-nums ${isShort ? 'text-amber-400' : 'text-green-400'}`}>
            {onDutyCount}/{app.min_staffing}
          </span>
          <button onClick={() => onAddOT(app.apparatus_id)}
            className="text-[10px] font-mono text-neutral-600 hover:text-sky-400 transition-colors px-1">
            +OT
          </button>
        </div>
      </div>

      {/* Crew rows */}
      <div className="px-3 py-2 min-h-[48px]">
        {positions.length === 0 ? (
          <p className="text-neutral-700 text-xs font-mono italic">NO CREW ASSIGNED</p>
        ) : (
          <ul className="space-y-1">
            {positions.map(pos => {
              const isLeave   = !ON_DUTY_TYPES.has(pos.assignmentType)
              // light_duty is on duty and not 'regular', but it carries its own
              // LD badge below — don't also label it as overtime.
              const isOT      = !isLeave && pos.assignmentType !== 'regular'
                                && countsForStaffing(pos.assignmentType)
              const original  = app.positions.find(p => p.id === pos.rosterId)?.employee ?? null

              return (
                <li key={posKey(pos)} className={`group flex items-center gap-1.5 text-xs font-mono rounded px-1 -mx-1 ${pos.isModified ? 'bg-amber-950/30' : ''}`}>
                  {/* Rank */}
                  <span className="text-[#c9a84c] w-14 shrink-0">
                    {pos.employee ? rankLabel(pos.employee.rank) : pos.position}
                  </span>

                  {/* Name */}
                  <span className={`flex-1 ${isLeave ? 'line-through text-neutral-600' : 'text-neutral-200'}`}>
                    {pos.employee
                      ? `${pos.employee.last_name}, ${pos.employee.first_name.charAt(0)}.`
                      : <span className="text-amber-500/60 not-italic">▸ open vacancy</span>}
                  </span>

                  {/* PM badge */}
                  {pos.employee?.is_paramedic && !isLeave && (
                    <span className="text-blue-400 text-[9px] font-bold">PM</span>
                  )}

                  {/* On duty but not filling a seat (light duty) */}
                  {!isLeave && pos.employee && !countsForStaffing(pos.assignmentType) && (
                    <span className="text-purple-400/80 text-[9px] font-bold">LD</span>
                  )}

                  {/* Leave / OT badge */}
                  {isLeave && (
                    <span className="text-amber-400 text-[9px] font-bold">{leaveLabel(pos.assignmentType).toUpperCase()}</span>
                  )}
                  {isOT && (
                    <span className="text-yellow-400 text-[9px] font-bold">{callbackLabel(pos.assignmentType).toUpperCase()}</span>
                  )}

                  {/* Modified dot */}
                  {pos.isModified && <span className="text-amber-500 text-[9px]">●</span>}

                  {/* Action buttons — always visible for usability on touch */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    {isLeave && original && (
                      <button onClick={() => onUpdate(posKey(pos), { employee: original, assignmentType: 'regular', isModified: false })}
                        title="Restore" className="text-[10px] text-neutral-600 hover:text-green-400 px-0.5 py-0.5 rounded transition-colors">↩</button>
                    )}
                    {!isLeave && pos.employee && original && (
                      <button onClick={() => setLeaveKey(posKey(pos))}
                        title="Mark absent" className="text-[10px] text-neutral-600 hover:text-amber-400 px-0.5 py-0.5 rounded transition-colors">OFF</button>
                    )}
                    <button onClick={() => setSwapKey(posKey(pos))}
                      title={pos.employee ? 'Swap' : 'Assign'}
                      className="text-[10px] text-neutral-600 hover:text-sky-400 px-0.5 py-0.5 rounded transition-colors">
                      {pos.employee ? '⇄' : '+'}
                    </button>
                    {pos.rosterId === 0 && (
                      <button onClick={() => onUpdate(posKey(pos), { assignmentType: 'remove' })}
                        className="text-[10px] text-neutral-600 hover:text-red-400 px-0.5 py-0.5 rounded transition-colors">✕</button>
                    )}
                  </div>

                  {/* Modals */}
                  {leaveKey === posKey(pos) && (
                    <LeaveMenu
                      onSelect={t => { onUpdate(posKey(pos), { assignmentType: t, isModified: true }); setLeaveKey(null) }}
                      onClose={() => setLeaveKey(null)}
                    />
                  )}
                  {swapKey === posKey(pos) && (
                    <EmployeeSearchModal
                      onSelect={(emp, at) => { onUpdate(posKey(pos), { employee: emp, assignmentType: at, isModified: true }); setSwapKey(null) }}
                      onClose={() => setSwapKey(null)}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── Station Section ───────────────────────────────────────────────────────────

function StationSection({ stationId, stationName, apps, posMap, onUpdate, onAddOT }: {
  stationId: number
  stationName: string
  apps: ApparatusRoster[]
  posMap: Map<string, EditablePosition[]>
  onUpdate: (key: string, updates: Partial<EditablePosition>) => void
  onAddOT: (id: string) => void
}) {
  const label = stationName.replace(/^Station \d+\s*[-–]?\s*/i, '').trim() || stationName
  const shortCount = apps.filter(a => {
    if (!apparatusCountsTowardMinimum(a.apparatus_id)) return false
    return assessStaffing(
      a.type,
      (posMap.get(a.apparatus_id) ?? []).map(p => ({
        rank: p.employee?.rank, assignmentType: p.employee ? p.assignmentType : 'vacant',
        isParamedic: p.employee?.is_paramedic,
      })),
      a.min_staffing,
    ).isShort
  }).length

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 mt-4 first:mt-0">
        <span className="text-[10px] font-mono font-bold tracking-[0.18em] text-neutral-500 uppercase">
          STA {stationId} — {label || `Station ${stationId}`}
        </span>
        {shortCount > 0 && <span className="text-[9px] font-mono font-bold text-amber-400">▲ {shortCount} SHORT</span>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {[...apps].sort((a, b) => {
          const ta = TYPE_ORDER[a.type] ?? 9
          const tb = TYPE_ORDER[b.type] ?? 9
          return ta !== tb ? ta - tb : a.apparatus_id.localeCompare(b.apparatus_id)
        }).map(app => (
          <ApparatusCard key={app.apparatus_id} app={app}
            positions={posMap.get(app.apparatus_id) ?? []}
            onUpdate={onUpdate} onAddOT={onAddOT} />
        ))}
      </div>
    </div>
  )
}

// ── Battalion Section ─────────────────────────────────────────────────────────

function BattalionSection({ battalion, apparatuses, posMap, onUpdate, onAddOT }: {
  battalion: typeof BATTALIONS[0]
  apparatuses: ApparatusRoster[]
  posMap: Map<string, EditablePosition[]>
  onUpdate: (key: string, updates: Partial<EditablePosition>) => void
  onAddOT: (id: string) => void
}) {
  const appMap = new Map(apparatuses.map(a => [a.apparatus_id, a]))
  const bcApp  = appMap.get(battalion.bc)

  const stationGroups = battalion.stations.map(stId => ({
    stationId: stId,
    stationName: `Station ${stId}`,
    apps: apparatuses.filter(a => a.station_id === stId),
  })).filter(sg => sg.apps.length > 0)

  const engines = apparatuses.filter(a =>
    battalion.stations.includes(a.station_id ?? -1) && a.type === 'engine')
  const shortCount = [...(bcApp ? [bcApp] : []), ...stationGroups.flatMap(s => s.apps)].filter(a => {
    if (!apparatusCountsTowardMinimum(a.apparatus_id)) return false
    return assessStaffing(
      a.type,
      (posMap.get(a.apparatus_id) ?? []).map(p => ({
        rank: p.employee?.rank, assignmentType: p.employee ? p.assignmentType : 'vacant',
        isParamedic: p.employee?.is_paramedic,
      })),
      a.min_staffing,
    ).isShort
  }).length

  const isNorth  = battalion.name.includes('North')
  const border   = isNorth ? 'border-sky-700/40'   : 'border-orange-700/40'
  const bg       = isNorth ? 'bg-sky-900/20'        : 'bg-orange-900/20'
  const textAccent = isNorth ? 'text-sky-400'       : 'text-orange-400'

  return (
    <div className={`border ${border} rounded-xl overflow-hidden`}>
      <div className={`${bg} border-b ${border} px-4 py-3 flex items-center justify-between flex-wrap gap-2`}>
        <div className="flex items-center gap-3">
          <h2 className={`text-sm font-mono font-bold tracking-[0.15em] ${textAccent} uppercase`}>{battalion.name}</h2>
          <div className="flex items-center gap-1.5">
            <StatusDot color={engines.length >= 1 ? 'green' : 'red'} />
            <span className={`text-[10px] font-mono font-bold ${engines.length >= 1 ? 'text-green-400' : 'text-red-400'}`}>
              {engines.length} ENGINE{engines.length !== 1 ? 'S' : ''} IN SERVICE
            </span>
          </div>
          {shortCount > 0 && (
            <span className="text-[10px] font-mono font-bold text-amber-400">
              · {shortCount} UNIT{shortCount !== 1 ? 'S' : ''} SHORT
            </span>
          )}
        </div>
      </div>

      <div className="px-4 py-3 space-y-4 bg-[#091520]">
        {bcApp && (
          <div>
            <p className="text-[10px] font-mono font-bold tracking-[0.18em] text-neutral-500 uppercase mb-2">BATTALION COMMAND</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              <ApparatusCard app={bcApp} positions={posMap.get(bcApp.apparatus_id) ?? []}
                onUpdate={onUpdate} onAddOT={onAddOT} />
            </div>
          </div>
        )}
        {stationGroups.map(sg => (
          <StationSection key={sg.stationId} stationId={sg.stationId} stationName={sg.stationName}
            apps={sg.apps} posMap={posMap} onUpdate={onUpdate} onAddOT={onAddOT} />
        ))}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ScheduleBuilder({
  date, shiftLetter, apparatuses, dataSource,
}: {
  date: string
  shiftLetter: string
  apparatuses: ApparatusRoster[]
  dataSource?: 'daily' | 'roster'
}) {
  // Build initial editable position map
  const buildMap = (): Map<string, EditablePosition[]> => {
    const map = new Map<string, EditablePosition[]>()
    for (const app of apparatuses) {
      map.set(app.apparatus_id, app.positions.map((p, i) => ({
        key:            `${app.apparatus_id}::${p.id}::${i}`,
        rosterId:       p.id,
        apparatusId:    app.apparatus_id,
        position:       p.position,
        sort_order:     p.sort_order,
        note:           p.note,
        employee:       p.employee,
        assignmentType: p.assignmentType ?? 'regular',
        isModified:     false,
      })))
    }
    return map
  }

  const [posMap, setPosMap] = useState<Map<string, EditablePosition[]>>(buildMap)
  const [publishStatus, setPublishStatus] = useState<'idle' | 'publishing' | 'success' | 'error'>('idle')
  const [publishError, setPublishError]   = useState<string | null>(null)
  const [addOTTarget, setAddOTTarget]     = useState<string | null>(null)
  const [, startTransition]               = useTransition()

  const onUpdate = useCallback((key: string, updates: Partial<EditablePosition>) => {
    setPosMap(prev => {
      const next = new Map(prev)
      for (const [appId, positions] of next) {
        const idx = positions.findIndex(p => p.key === key)
        if (idx === -1) continue
        if (updates.assignmentType === 'remove') {
          next.set(appId, positions.filter((_, i) => i !== idx))
        } else {
          const updated = [...positions]
          updated[idx] = { ...updated[idx], ...updates }
          next.set(appId, updated)
        }
        break
      }
      return next
    })
  }, [])

  const handleAddOTEmployee = useCallback((emp: EmployeeOption | null, assignmentType: string) => {
    if (!addOTTarget) return
    setPosMap(prev => {
      const next      = new Map(prev)
      const positions = [...(next.get(addOTTarget) ?? [])]
      const maxOrder  = positions.reduce((m, p) => Math.max(m, p.sort_order), 0)
      const newPos: EditablePosition = {
        key:            `${addOTTarget}::0::ot-${Date.now()}`,
        rosterId:       0,
        apparatusId:    addOTTarget,
        position:       'OT',
        sort_order:     maxOrder + 10,
        note:           null,
        employee:       emp,
        assignmentType,
        isModified:     true,
      }
      next.set(addOTTarget, [...positions, newPos])
      return next
    })
    setAddOTTarget(null)
  }, [addOTTarget])

  const handlePublish = () => {
    startTransition(async () => {
      setPublishStatus('publishing')
      setPublishError(null)
      const entries = [...posMap.values()].flat().map(p => ({
        apparatus_id:    p.apparatusId,
        employee_id:     p.employee?.id ?? null,
        position:        p.position,
        assignment_type: p.assignmentType,
        sort_order:      p.sort_order,
        note:            p.note,
      }))
      try {
        const res = await fetch('/api/assignments/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, shiftLetter, entries }),
        })
        if (!res.ok) {
          const b = await res.json() as { error?: string }
          setPublishError(b.error ?? 'Error')
          setPublishStatus('error')
        } else {
          setPublishStatus('success')
        }
      } catch (err) {
        setPublishError(err instanceof Error ? err.message : 'Network error')
        setPublishStatus('error')
      }
    })
  }

  // Computed stats
  const allPositions     = [...posMap.values()].flat()
  // Must match the crew board's "On Duty" tile exactly: seat-filling assignment
  // types, on an active apparatus, counted by distinct employee so one body
  // never counts twice.
  const onDutyCount      = new Set(
    allPositions
      .filter(p =>
        countsForStaffing(p.assignmentType) &&
        p.employee &&
        apparatusCountsTowardMinimum(p.apparatusId),
      )
      .map(p => p.employee!.id),
  ).size
  const totalModified    = allPositions.filter(p => p.isModified).length
  const shiftBadgeClass  = SHIFT_BADGE[shiftLetter] ?? 'text-neutral-400 border-neutral-700 bg-neutral-900/20'

  // Staffing status across all apparatus
  const shortUnits = apparatuses.filter(app => {
    if (!apparatusCountsTowardMinimum(app.apparatus_id)) return false
    return assessStaffing(
      app.type,
      (posMap.get(app.apparatus_id) ?? []).map(p => ({
        rank: p.employee?.rank, assignmentType: p.employee ? p.assignmentType : 'vacant',
        isParamedic: p.employee?.is_paramedic,
      })),
      app.min_staffing,
    ).isShort
  })
  const staffingMet = shortUnits.length === 0

  // Date navigation helpers
  const prev = new Date(date + 'T12:00:00'); prev.setDate(prev.getDate() - 1)
  const next = new Date(date + 'T12:00:00'); next.setDate(next.getDate() + 1)
  const todayStr = new Date(Date.now() - 7 * 3600_000).toISOString().slice(0, 10)
  const prevStr  = prev.toISOString().slice(0, 10)
  const nextStr  = next.toISOString().slice(0, 10)
  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans">

      {/* ── Page header ── */}
      <header className="bg-neutral-900 border-b border-neutral-800">
        <div className="max-w-screen-2xl mx-auto px-4 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-base font-bold tracking-widest uppercase text-white leading-none">
                Salem Fire Department
              </h1>
              <p className="text-neutral-400 text-xs tracking-widest uppercase mt-0.5">Crew Scheduler</p>
            </div>
            <span className={`text-sm font-mono font-bold px-2.5 py-1 rounded border ${shiftBadgeClass}`}>
              {shiftLetter} SHIFT
            </span>
            {totalModified > 0 && (
              <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-900/20 border border-amber-700/30 rounded px-1.5 py-0.5">
                {totalModified} CHANGE{totalModified !== 1 ? 'S' : ''}
              </span>
            )}
          </div>

          {/* Nav links */}
          <div className="flex items-center gap-4 text-xs font-mono text-neutral-500">
            <Link href="/" className="hover:text-neutral-300 transition-colors">← Home</Link>
            <Link href="/crew-board" className="hover:text-neutral-300 transition-colors">Crew Board ▸</Link>
            <Link href="/import" className="hover:text-neutral-300 transition-colors">Import PDF ▸</Link>
          </div>
        </div>

        {/* Status bar */}
        <div className="border-t border-neutral-800 bg-neutral-950/50">
          <div className="max-w-screen-2xl mx-auto px-4 py-2 flex items-center gap-6 flex-wrap text-xs font-mono">
            <div className="flex items-center gap-1.5">
              <span className="text-neutral-500">On Duty</span>
              <span className="text-white font-bold text-sm">{onDutyCount}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <StatusDot color={staffingMet ? 'green' : 'amber'} />
              {staffingMet
                ? <span className="text-green-400 font-bold">MIN STAFFING MET</span>
                : <span className="text-amber-400 font-bold">{shortUnits.length} UNIT{shortUnits.length !== 1 ? 'S' : ''} SHORT</span>
              }
            </div>
            {dataSource === 'daily'
              ? <span className="text-sky-400 text-[10px] font-bold border border-sky-700/40 rounded px-1.5 py-0.5 bg-sky-900/20">● DAILY ASSIGNMENTS</span>
              : <span className="text-neutral-600 text-[10px] border border-neutral-700 rounded px-1.5 py-0.5">BASE ROSTER</span>
            }
            <div className="ml-auto flex items-center gap-2">
              {publishStatus === 'success' && <span className="text-green-400">✓ Published</span>}
              {publishStatus === 'error'   && <span className="text-red-400" title={publishError ?? ''}>✕ Error</span>}
              <button onClick={handlePublish} disabled={publishStatus === 'publishing'}
                className={`font-mono font-bold text-xs px-4 py-1.5 rounded border transition-colors ${
                  publishStatus === 'publishing'
                    ? 'border-neutral-700 text-neutral-600 bg-neutral-900/50 cursor-not-allowed'
                    : 'border-sky-600 text-sky-300 bg-sky-900/30 hover:bg-sky-800/40 hover:text-sky-200'
                }`}>
                {publishStatus === 'publishing' ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </div>
        </div>

        {/* Date nav */}
        <div className="border-t border-neutral-800">
          <div className="max-w-screen-2xl mx-auto px-4 py-2 flex items-center gap-3">
            <Link href={`/schedule/${prevStr}`}
              className="text-xs font-mono text-neutral-500 hover:text-neutral-300 transition-colors px-2 py-1 rounded hover:bg-neutral-800">
              ◀ PREV
            </Link>
            <span className="text-sm font-mono font-bold text-neutral-200 tracking-wide">{dateLabel}</span>
            <Link href={`/schedule/${nextStr}`}
              className="text-xs font-mono text-neutral-500 hover:text-neutral-300 transition-colors px-2 py-1 rounded hover:bg-neutral-800">
              NEXT ▶
            </Link>
            {date !== todayStr && (
              <Link href={`/schedule/${todayStr}`}
                className="text-xs font-mono text-neutral-500 hover:text-neutral-300 transition-colors px-2 py-1 rounded hover:bg-neutral-800">
                TODAY
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Red divider */}
      <div className="h-px bg-red-700 opacity-60" />

      {/* ── Content ── */}
      <main className="max-w-screen-2xl mx-auto px-4 py-5 space-y-5">
        {BATTALIONS.map(battalion => (
          <BattalionSection
            key={battalion.name}
            battalion={battalion}
            apparatuses={apparatuses}
            posMap={posMap}
            onUpdate={onUpdate}
            onAddOT={setAddOTTarget}
          />
        ))}
      </main>

      {/* Add OT modal */}
      {addOTTarget && (
        <EmployeeSearchModal
          onSelect={handleAddOTEmployee}
          onClose={() => setAddOTTarget(null)}
        />
      )}
    </div>
  )
}
