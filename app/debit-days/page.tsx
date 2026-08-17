'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'

// ── Types ────────────────────────────────────────────────────

type Status = 'scheduled' | 'worked' | 'covered_by_vacation' | 'cancelled'

interface DebitDay {
  id:           number
  employeeId:   number | null
  employeeName: string
  shift:        string
  track:        number
  apparatus:    string
  position:     string
  date:         string
  status:       Status
  notes:        string | null
}

interface ByEmployee {
  name: string
  days: DebitDay[]
}

interface ApiResponse {
  asOf:         string
  fiscalYear:   number
  fyEnd:        string
  todayWorkers: DebitDay[]
  upcoming:     DebitDay[]
  byEmployee:   ByEmployee[]
}

// ── Helpers ─────────────────────────────────────────────────

const STATUS_STYLES: Record<Status, { bg: string; text: string; label: string }> = {
  scheduled:           { bg: 'bg-blue-100',   text: 'text-blue-800',   label: 'Scheduled' },
  worked:              { bg: 'bg-green-100',  text: 'text-green-800',  label: 'Worked' },
  covered_by_vacation: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Vacation Cover' },
  cancelled:           { bg: 'bg-gray-100',   text: 'text-gray-500',   label: 'Cancelled' },
}

const POSITION_LABELS: Record<string, string> = {
  CAPTAIN:    'Captain',
  ENGINEER_1: 'Engineer',
  ENGINEER_2: 'Engineer',
  FF_1:       'FF',
  FF_2:       'FF',
  FF_3:       'FF',
}

function posLabel(pos: string) {
  return POSITION_LABELS[pos] ?? pos
}

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    timeZone: 'UTC',
  })
}

function formatDateFull(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'UTC',
  })
}

function StatusBadge({ status }: { status: Status }) {
  const s = STATUS_STYLES[status]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}

// ── Today Tab ───────────────────────────────────────────────

function TodayTab({ workers, shiftFilter, asOf }: {
  workers: DebitDay[]
  shiftFilter: string
  asOf: string
}) {
  const filtered = shiftFilter === 'All'
    ? workers
    : workers.filter(d => d.shift === shiftFilter)

  if (filtered.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-lg font-medium">No debit day workers today</p>
        <p className="text-sm mt-1">{formatDateFull(asOf)}</p>
      </div>
    )
  }

  // Group by apparatus
  const byApparatus = new Map<string, DebitDay[]>()
  for (const d of filtered) {
    if (!byApparatus.has(d.apparatus)) byApparatus.set(d.apparatus, [])
    byApparatus.get(d.apparatus)!.push(d)
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">{formatDateFull(asOf)}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from(byApparatus.entries()).map(([apparatus, days]) => (
          <div key={apparatus} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="bg-gray-800 text-white px-4 py-2 flex items-center justify-between">
              <span className="font-semibold">{apparatus}</span>
              <span className="text-xs text-gray-300">Track {days[0].track} · Shift {days[0].shift}</span>
            </div>
            <div className="divide-y divide-gray-100">
              {days.map(d => (
                <div key={d.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{d.employeeName}</p>
                    <p className="text-xs text-gray-500">{posLabel(d.position)}</p>
                  </div>
                  <StatusBadge status={d.status} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Full Schedule Tab ────────────────────────────────────────

function ScheduleTab({ upcoming, shiftFilter }: {
  upcoming: DebitDay[]
  shiftFilter: string
}) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    let list = shiftFilter === 'All' ? upcoming : upcoming.filter(d => d.shift === shiftFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(d =>
        d.employeeName.toLowerCase().includes(q) ||
        d.apparatus.toLowerCase().includes(q)
      )
    }
    return list
  }, [upcoming, shiftFilter, search])

  // Group by date
  const byDate = useMemo(() => {
    const map = new Map<string, DebitDay[]>()
    for (const d of filtered) {
      if (!map.has(d.date)) map.set(d.date, [])
      map.get(d.date)!.push(d)
    }
    return Array.from(map.entries())
  }, [filtered])

  return (
    <div>
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by name or apparatus…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {byDate.length === 0 ? (
        <p className="text-gray-400 text-center py-12">No upcoming debit days match your filter.</p>
      ) : (
        <div className="space-y-6">
          {byDate.map(([date, days]) => (
            <div key={date}>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {formatDateFull(date)}
              </h3>
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-2 text-left">Name</th>
                      <th className="px-4 py-2 text-left">Apparatus</th>
                      <th className="px-4 py-2 text-left">Position</th>
                      <th className="px-4 py-2 text-left">Shift</th>
                      <th className="px-4 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {days.map(d => (
                      <tr key={d.id} className={d.status === 'cancelled' ? 'opacity-40' : ''}>
                        <td className="px-4 py-2 font-medium text-gray-900">{d.employeeName}</td>
                        <td className="px-4 py-2 text-gray-600">{d.apparatus}</td>
                        <td className="px-4 py-2 text-gray-600">{posLabel(d.position)}</td>
                        <td className="px-4 py-2 text-gray-600">{d.shift}</td>
                        <td className="px-4 py-2"><StatusBadge status={d.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── By Person Tab ────────────────────────────────────────────

function ByPersonTab({ byEmployee, shiftFilter }: {
  byEmployee: ByEmployee[]
  shiftFilter: string
}) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const filtered = useMemo(() => {
    let list = byEmployee
    if (shiftFilter !== 'All') {
      list = list
        .map(e => ({ ...e, days: e.days.filter(d => d.shift === shiftFilter) }))
        .filter(e => e.days.length > 0)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(e => e.name.toLowerCase().includes(q))
    }
    return list
  }, [byEmployee, shiftFilter, search])

  return (
    <div>
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-gray-400 text-center py-12">No employees match your filter.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(({ name, days }) => {
            const isOpen = expanded === name
            const remaining = days.filter(d => d.status === 'scheduled').length
            const worked    = days.filter(d => d.status === 'worked').length
            const nextDay   = days.find(d => d.status === 'scheduled')

            return (
              <div key={name} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <button
                  onClick={() => setExpanded(isOpen ? null : name)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-gray-900">{name}</span>
                    {days[0] && (
                      <span className="text-xs text-gray-400">Shift {days[0].shift} · {days[0].apparatus}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    {nextDay && (
                      <span className="text-blue-600 font-medium">Next: {formatDate(nextDay.date)}</span>
                    )}
                    <span>{worked} worked · {remaining} remaining</span>
                    <span className="text-gray-400">{isOpen ? '▲' : '▼'}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-gray-100">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                        <tr>
                          <th className="px-4 py-2 text-left">Date</th>
                          <th className="px-4 py-2 text-left">Apparatus</th>
                          <th className="px-4 py-2 text-left">Position</th>
                          <th className="px-4 py-2 text-left">Status</th>
                          <th className="px-4 py-2 text-left">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {days.map(d => (
                          <tr key={d.id} className={d.status === 'cancelled' ? 'opacity-40' : ''}>
                            <td className="px-4 py-2 text-gray-900">{formatDateFull(d.date)}</td>
                            <td className="px-4 py-2 text-gray-600">{d.apparatus}</td>
                            <td className="px-4 py-2 text-gray-600">{posLabel(d.position)}</td>
                            <td className="px-4 py-2"><StatusBadge status={d.status} /></td>
                            <td className="px-4 py-2 text-gray-400 text-xs">{d.notes ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────

type Tab = 'today' | 'schedule' | 'person'

export default function DebitDaysPage() {
  const [data, setData]           = useState<ApiResponse | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)
  const [tab, setTab]             = useState<Tab>('today')
  const [shiftFilter, setShift]   = useState<string>('All')
  const [selectedDate, setDate]   = useState(() => new Date().toISOString().split('T')[0])

  const isToday = selectedDate === new Date().toISOString().split('T')[0]

  async function load(date: string) {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/debit-days?date=${date}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load')
      setData(json)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(selectedDate) }, [selectedDate])

  // Auto-refresh every 5 min when viewing today
  useEffect(() => {
    if (!isToday) return
    const id = setInterval(() => load(selectedDate), 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [isToday, selectedDate])

  const TABS: { id: Tab; label: string }[] = [
    { id: 'today',    label: 'Today' },
    { id: 'schedule', label: 'Full Schedule' },
    { id: 'person',   label: 'By Person' },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="bg-gray-900 text-white px-4 py-3 flex items-center gap-4 flex-wrap">
        <Link href="/"         className="text-gray-400 hover:text-white text-sm">← Crew Board</Link>
        <Link href="/mot"      className="text-gray-400 hover:text-white text-sm">MOT</Link>
        <Link href="/callback" className="text-gray-400 hover:text-white text-sm">Callback</Link>
        <span className="font-semibold tracking-wide">DEBIT DAY SCHEDULE</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => { const d = new Date(selectedDate + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); setDate(d.toISOString().split('T')[0]) }}
            className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">←</button>
          <input type="date" value={selectedDate}
            onChange={e => setDate(e.target.value)}
            className="bg-gray-700 text-white px-2 py-1 rounded text-sm border-none outline-none" />
          <button onClick={() => { const d = new Date(selectedDate + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); setDate(d.toISOString().split('T')[0]) }}
            className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">→</button>
          {!isToday && (
            <button onClick={() => setDate(new Date().toISOString().split('T')[0])}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium">Today</button>
          )}
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Controls row */}
        <div className="flex items-center gap-4 mb-6 flex-wrap">
          {/* Tabs */}
          <div className="flex bg-white border border-gray-200 rounded-lg p-1 gap-1">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:text-gray-900'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Shift filter */}
          <div className="flex gap-1">
            {['All', 'A', 'B', 'C', 'D'].map(s => (
              <button key={s} onClick={() => setShift(s)}
                className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
                  shiftFilter === s
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}>
                {s === 'All' ? 'All Shifts' : `Shift ${s}`}
              </button>
            ))}
          </div>

          {data && (
            <span className="text-xs text-gray-400 ml-auto">
              FY{data.fiscalYear} · through {data.fyEnd}
            </span>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <svg className="animate-spin h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
            Loading…
          </div>
        )}

        {/* Content */}
        {!loading && data && (
          <>
            {tab === 'today' && (
              <TodayTab
                workers={data.todayWorkers}
                shiftFilter={shiftFilter}
                asOf={data.asOf}
              />
            )}
            {tab === 'schedule' && (
              <ScheduleTab
                upcoming={data.upcoming}
                shiftFilter={shiftFilter}
              />
            )}
            {tab === 'person' && (
              <ByPersonTab
                byEmployee={data.byEmployee}
                shiftFilter={shiftFilter}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
