'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { recordMandateAction, setLastMandatoryDateAction } from './actions'

// ── Types ────────────────────────────────────────────────────────────────────

interface Member {
  id: number
  employeeId: number
  name: string
  rank: string
  shift: string
  listPosition: number
  lastMandatoryDate: string | null
  timesMandatoried: number
  eligible: boolean
  exclusionLabels: string[]
}

interface Classification {
  listType: string
  label: string
  members: Member[]
  eligibleCount: number
}

interface ApiResponse {
  shiftDate: string
  fiscalYear: number
  classifications: Classification[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function tomorrowStr() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function fmtShiftDate(iso: string) {
  const d = new Date(iso + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

// ── Mandate Dialog ────────────────────────────────────────────────────────────

interface DialogState {
  mode: 'mandate' | 'correct'
  member: Member
  listType: string
  fiscalYear: number
}

function MandateDialog({
  state,
  onClose,
  onSuccess,
}: {
  state: DialogState
  onClose: () => void
  onSuccess: () => void
}) {
  const [date, setDate] = useState(todayStr())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      let result
      if (state.mode === 'mandate') {
        result = await recordMandateAction(
          state.member.id,
          state.listType,
          state.fiscalYear,
          date + 'T08:00:00',
        )
      } else {
        result = await setLastMandatoryDateAction(state.member.id, date + 'T08:00:00')
      }
      if (result.error) {
        setErr(result.error)
      } else {
        onSuccess()
        onClose()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="mb-1 font-mono text-xs tracking-widest uppercase text-zinc-400">
          {state.mode === 'mandate' ? 'Record Mandate' : 'Correct Date Only'}
        </h2>
        <p className="mb-5 text-base font-semibold text-white">{state.member.name}</p>

        {state.mode === 'mandate' && (
          <p className="mb-4 text-xs text-zinc-400">
            This will move {state.member.name} to the bottom of the{' '}
            <span className="text-zinc-200">{state.listType.replace(/_mand$/, '').replace(/_/g, ' ')}</span>{' '}
            list and record the mandate date.
          </p>
        )}
        {state.mode === 'correct' && (
          <p className="mb-4 text-xs text-zinc-400">
            Updates the last mandatory date only — does not change list position.
          </p>
        )}

        <label className="block mb-4">
          <span className="mb-1 block text-xs font-mono uppercase tracking-wider text-zinc-500">
            Mandate Date
          </span>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none"
          />
        </label>

        {err && <p className="mb-3 rounded bg-red-900/30 px-3 py-2 text-xs text-red-400">{err}</p>}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded border border-zinc-700 py-2 text-sm text-zinc-400 hover:border-zinc-500 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="flex-1 rounded bg-emerald-700 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Saving…' : state.mode === 'mandate' ? 'Record Mandate' : 'Update Date'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Classification Card ───────────────────────────────────────────────────────

function ClassCard({
  cls,
  fiscalYear,
  onMandate,
}: {
  cls: Classification
  fiscalYear: number
  onMandate: (member: Member, listType: string, fy: number, mode: 'mandate' | 'correct') => void
}) {
  const eligible  = cls.members.filter(m => m.eligible)
  const excluded  = cls.members.filter(m => !m.eligible)
  const nextUp    = eligible[0] ?? null

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <h2 className="font-mono text-[11px] tracking-widest uppercase text-zinc-300">
          {cls.label}
        </h2>
        <span className="rounded-full bg-emerald-900/50 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
          {cls.eligibleCount} eligible
        </span>
      </div>

      {cls.members.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-zinc-600">No list data</p>
      ) : (
        <>
          {/* Next Up banner */}
          {nextUp && (
            <div className="flex items-center justify-between border-b border-zinc-800 bg-emerald-950/30 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="rounded bg-emerald-700 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  NEXT UP
                </span>
                <span className="text-sm font-semibold text-white">{nextUp.name}</span>
                <span className="text-[10px] text-zinc-500">#{nextUp.listPosition}</span>
              </div>
              <button
                onClick={() => onMandate(nextUp, cls.listType, fiscalYear, 'mandate')}
                className="rounded border border-emerald-700/60 px-2.5 py-1 text-[10px] font-mono tracking-wider uppercase text-emerald-400 hover:border-emerald-500 hover:text-emerald-300 transition-colors"
              >
                Record Mandate ▸
              </button>
            </div>
          )}

          {/* Member table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-left">
                  <th className="px-3 py-2 font-mono text-[10px] tracking-wider uppercase text-zinc-600">#</th>
                  <th className="px-3 py-2 font-mono text-[10px] tracking-wider uppercase text-zinc-600">Name</th>
                  <th className="px-3 py-2 font-mono text-[10px] tracking-wider uppercase text-zinc-600 hidden sm:table-cell">Shift</th>
                  <th className="px-3 py-2 font-mono text-[10px] tracking-wider uppercase text-zinc-600">Status</th>
                  <th className="px-3 py-2 font-mono text-[10px] tracking-wider uppercase text-zinc-600 hidden md:table-cell">Last Mandatory</th>
                  <th className="px-3 py-2 font-mono text-[10px] tracking-wider uppercase text-zinc-600"></th>
                </tr>
              </thead>
              <tbody>
                {/* Eligible rows */}
                {eligible.map(m => (
                  <tr key={m.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                    <td className="px-3 py-2 text-zinc-500">{m.listPosition}</td>
                    <td className="px-3 py-2 font-medium text-white">{m.name}</td>
                    <td className="px-3 py-2 text-zinc-400 hidden sm:table-cell">{m.shift}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-emerald-900/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                        Eligible
                      </span>
                    </td>
                    <td className="px-3 py-2 text-zinc-500 hidden md:table-cell">{fmtDate(m.lastMandatoryDate)}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => onMandate(m, cls.listType, fiscalYear, 'mandate')}
                        className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-white transition-colors"
                      >
                        Mandate
                      </button>
                    </td>
                  </tr>
                ))}

                {/* Divider between eligible and excluded */}
                {eligible.length > 0 && excluded.length > 0 && (
                  <tr>
                    <td colSpan={6} className="bg-zinc-800/40 px-3 py-1">
                      <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">Not Available</span>
                    </td>
                  </tr>
                )}

                {/* Excluded rows */}
                {excluded.map(m => (
                  <tr key={m.id} className="border-b border-zinc-800/30 opacity-50 hover:opacity-70 transition-opacity">
                    <td className="px-3 py-2 text-zinc-600">{m.listPosition}</td>
                    <td className="px-3 py-2 text-zinc-400">{m.name}</td>
                    <td className="px-3 py-2 text-zinc-600 hidden sm:table-cell">{m.shift}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-red-900/30 px-2 py-0.5 text-[10px] font-semibold text-red-500">
                        {m.exclusionLabels[0] ?? 'Excluded'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-zinc-600 hidden md:table-cell">{fmtDate(m.lastMandatoryDate)}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => onMandate(m, cls.listType, fiscalYear, 'correct')}
                        className="rounded border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-600 hover:border-zinc-600 hover:text-zinc-400 transition-colors"
                      >
                        Fix Date
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MotPage() {
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [data, setData]         = useState<ApiResponse | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [dialog, setDialog]     = useState<DialogState | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const refreshTimer = useRef<NodeJS.Timeout | null>(null)

  const fetchData = useCallback(async (date: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/mot-eligibility?date=${date}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setLastRefresh(new Date())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load + date changes
  useEffect(() => {
    fetchData(selectedDate)
  }, [selectedDate, fetchData])

  // Auto-refresh every 5 min when showing today
  useEffect(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current)
    if (selectedDate === todayStr()) {
      refreshTimer.current = setInterval(() => fetchData(selectedDate), 5 * 60 * 1000)
    }
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current) }
  }, [selectedDate, fetchData])

  function handleMandate(member: Member, listType: string, fy: number, mode: 'mandate' | 'correct') {
    setDialog({ mode, member, listType, fiscalYear: fy })
  }

  const isToday    = selectedDate === todayStr()
  const isTomorrow = selectedDate === tomorrowStr()

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="font-mono text-[10px] tracking-widest uppercase text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              ◂ Crew Board
            </Link>
            <span className="text-zinc-700">|</span>
            <h1 className="font-mono text-[11px] tracking-widest uppercase text-zinc-300">
              MOT Eligibility
            </h1>
          </div>

          {/* Date controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedDate(todayStr())}
              className={`rounded border px-3 py-1.5 text-[10px] font-mono tracking-widest uppercase transition-colors ${
                isToday
                  ? 'border-zinc-500 bg-zinc-800 text-white'
                  : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setSelectedDate(tomorrowStr())}
              className={`rounded border px-3 py-1.5 text-[10px] font-mono tracking-widest uppercase transition-colors ${
                isTomorrow
                  ? 'border-zinc-500 bg-zinc-800 text-white'
                  : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'
              }`}
            >
              Tomorrow
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 focus:border-zinc-500 focus:outline-none"
            />
            <button
              onClick={() => fetchData(selectedDate)}
              disabled={loading}
              className="rounded border border-zinc-700 px-3 py-1.5 text-[10px] font-mono tracking-widest uppercase text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 disabled:opacity-40 transition-colors"
            >
              {loading ? '…' : '↺'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {/* Shift date + refresh info */}
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-zinc-200">
            {data ? fmtShiftDate(data.shiftDate) : '—'}
            {data && (
              <span className="ml-2 font-mono text-xs text-zinc-500">
                FY{data.fiscalYear}
              </span>
            )}
          </h2>
          <span className="text-[10px] text-zinc-600">
            Updated {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {isToday && ' · auto-refresh 5 min'}
          </span>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 rounded border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-400">
            Error loading eligibility: {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !data && (
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-48 animate-pulse rounded-lg bg-zinc-800/40" />
            ))}
          </div>
        )}

        {/* No data */}
        {!loading && data && data.classifications.every(c => c.members.length === 0) && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 py-16 text-center">
            <p className="font-mono text-xs uppercase tracking-widest text-zinc-600">
              NO MOT LIST DATA FOUND
            </p>
            <p className="mt-2 text-xs text-zinc-700">
              Populate the <code className="text-zinc-500">ot_list_positions</code> table to see eligibility.
            </p>
          </div>
        )}

        {/* Classification cards */}
        {data && data.classifications.some(c => c.members.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            {data.classifications.map(cls => (
              <ClassCard
                key={cls.listType}
                cls={cls}
                fiscalYear={data.fiscalYear}
                onMandate={handleMandate}
              />
            ))}
          </div>
        )}
      </main>

      {/* Mandate dialog */}
      {dialog && (
        <MandateDialog
          state={dialog}
          onClose={() => setDialog(null)}
          onSuccess={() => fetchData(selectedDate)}
        />
      )}
    </div>
  )
}
