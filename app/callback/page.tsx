'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { recordCallbackAction, setLastCallbackDateAction } from './actions'

// ── Types ────────────────────────────────────────────────────────────────────

interface Member {
  id: string
  employeeId: number
  name: string
  rank: string
  shift: string
  listPosition: number
  lastCallbackDate: string | null
  timesWorked: number
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

type DialogMode = 'callback' | 'correct'

interface DialogState {
  mode: DialogMode
  member: Member
  listType: string
  fiscalYear: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

function tomorrowStr(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(`${iso}T12:00:00Z`)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDisplayDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function nowLocalISO(): string {
  const now = new Date()
  const off = now.getTimezoneOffset()
  const local = new Date(now.getTime() - off * 60000)
  return local.toISOString().slice(0, 16)
}

// ── ClassCard ────────────────────────────────────────────────────────────────

function ClassCard({
  cls,
  onCallback,
  onCorrect,
}: {
  cls: Classification
  onCallback: (member: Member, listType: string, fiscalYear: number) => void
  onCorrect: (member: Member, listType: string, fiscalYear: number) => void
}) {
  const eligible  = cls.members.filter(m => m.eligible)
  const excluded  = cls.members.filter(m => !m.eligible)
  const nextUp    = eligible[0] ?? null

  return (
    <div style={{
      background: '#111',
      border: '1px solid #2a2a2a',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid #2a2a2a',
      }}>
        <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.08em', color: '#ccc', textTransform: 'uppercase' }}>
          {cls.label}
        </span>
        <span style={{
          background: cls.eligibleCount > 0 ? '#14532d' : '#3f1f1f',
          color: cls.eligibleCount > 0 ? '#4ade80' : '#f87171',
          fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 99,
        }}>
          {cls.eligibleCount} eligible
        </span>
      </div>

      {/* Next Up banner */}
      {nextUp && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', background: '#0d1f17', borderBottom: '1px solid #1a3328',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ background: '#15803d', color: '#bbf7d0', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: '0.06em' }}>
              NEXT UP
            </span>
            <span style={{ color: '#fff', fontWeight: 600 }}>{nextUp.name}</span>
            <span style={{ color: '#6b7280', fontSize: 13 }}>#{nextUp.listPosition}</span>
          </div>
          <button
            onClick={() => onCallback(nextUp, cls.listType, 0)}
            style={{
              background: '#15803d', color: '#fff', border: 'none', borderRadius: 6,
              padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              letterSpacing: '0.04em',
            }}
          >
            RECORD CALLBACK ▸
          </button>
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
              {['#', 'Name', 'Shift', 'Status', 'Last Callback', ''].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 600, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {eligible.map(m => (
              <tr key={m.id} style={{ borderBottom: '1px solid #1e1e1e' }}>
                <td style={{ padding: '8px 12px', color: '#9ca3af' }}>{m.listPosition}</td>
                <td style={{ padding: '8px 12px', color: '#fff', fontWeight: 500 }}>{m.name}</td>
                <td style={{ padding: '8px 12px', color: '#9ca3af' }}>{m.shift || '—'}</td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{ background: '#14532d', color: '#4ade80', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99 }}>
                    Eligible
                  </span>
                </td>
                <td style={{ padding: '8px 12px', color: '#9ca3af' }}>{formatDate(m.lastCallbackDate)}</td>
                <td style={{ padding: '8px 12px' }}>
                  <button
                    onClick={() => onCallback(m, cls.listType, 0)}
                    style={{
                      background: '#1f2937', color: '#d1d5db', border: '1px solid #374151',
                      borderRadius: 5, padding: '3px 10px', fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    Callback
                  </button>
                </td>
              </tr>
            ))}

            {excluded.length > 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '6px 12px', background: '#0d0d0d', color: '#4b5563', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Not Available
                </td>
              </tr>
            )}

            {excluded.map(m => (
              <tr key={m.id} style={{ borderBottom: '1px solid #1a1a1a', opacity: 0.6 }}>
                <td style={{ padding: '8px 12px', color: '#6b7280' }}>{m.listPosition}</td>
                <td style={{ padding: '8px 12px', color: '#9ca3af', fontWeight: 500 }}>{m.name}</td>
                <td style={{ padding: '8px 12px', color: '#6b7280' }}>{m.shift || '—'}</td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{ background: '#3f1f1f', color: '#f87171', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99 }}>
                    {m.exclusionLabels[0] ?? 'Unavailable'}
                  </span>
                </td>
                <td style={{ padding: '8px 12px', color: '#6b7280' }}>{formatDate(m.lastCallbackDate)}</td>
                <td style={{ padding: '8px 12px' }}>
                  <button
                    onClick={() => onCorrect(m, cls.listType, 0)}
                    style={{
                      background: 'transparent', color: '#6b7280', border: '1px solid #374151',
                      borderRadius: 5, padding: '3px 10px', fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    Fix Date
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── CallbackDialog ───────────────────────────────────────────────────────────

function CallbackDialog({
  dialog,
  fiscalYear,
  onClose,
  onRefresh,
}: {
  dialog: DialogState
  fiscalYear: number
  onClose: () => void
  onRefresh: () => void
}) {
  const [dateTime, setDateTime] = useState(nowLocalISO())
  const [isFullShift, setIsFullShift] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const isCallback = dialog.mode === 'callback'

  async function handleConfirm() {
    setBusy(true)
    setErr(null)
    try {
      const isoDate = new Date(dateTime).toISOString()
      let result: { error?: string }
      if (isCallback) {
        result = await recordCallbackAction(
          dialog.member.id,
          dialog.listType,
          fiscalYear,
          isoDate,
          isFullShift,
        )
      } else {
        result = await setLastCallbackDateAction(dialog.member.id, isoDate)
      }
      if (result.error) { setErr(result.error); setBusy(false); return }
      onClose()
      onRefresh()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Unknown error')
      setBusy(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#1a1a1a', border: '1px solid #333', borderRadius: 10,
        padding: 24, width: 360, maxWidth: '90vw',
      }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
            {isCallback ? 'Record Callback' : 'Correct Date'}
          </div>
          <div style={{ color: '#9ca3af', fontSize: 13 }}>{dialog.member.name}</div>
        </div>

        {err && (
          <div style={{ background: '#3f1f1f', color: '#f87171', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
            {err}
          </div>
        )}

        <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, marginBottom: 6 }}>
          {isCallback ? 'Callback date / time' : 'Correct date / time'}
        </label>
        <input
          type="datetime-local"
          value={dateTime}
          onChange={e => setDateTime(e.target.value)}
          style={{
            width: '100%', background: '#111', border: '1px solid #333', borderRadius: 6,
            color: '#fff', padding: '8px 10px', fontSize: 14, boxSizing: 'border-box', marginBottom: 16,
          }}
        />

        {isCallback && (
          <label style={{
            display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
            color: '#d1d5db', fontSize: 13, marginBottom: 20,
            background: '#111', border: '1px solid #333', borderRadius: 6, padding: '10px 12px',
          }}>
            <input
              type="checkbox"
              checked={isFullShift}
              onChange={e => setIsFullShift(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: '#22c55e', cursor: 'pointer' }}
            />
            <div>
              <div style={{ fontWeight: 600 }}>Full shift (20+ hours)</div>
              <div style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>
                {isFullShift ? 'Person will move to bottom of list' : 'Date recorded — position unchanged'}
              </div>
            </div>
          </label>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, background: '#2a2a2a', color: '#9ca3af', border: '1px solid #333',
              borderRadius: 6, padding: '9px 0', fontSize: 13, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            style={{
              flex: 2,
              background: isCallback ? '#15803d' : '#1d4ed8',
              color: '#fff', border: 'none', borderRadius: 6,
              padding: '9px 0', fontSize: 13, fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Saving…' : isCallback ? (isFullShift ? 'Record & Move to Bottom' : 'Record Date Only') : 'Save Date'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CallbackPage() {
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [data, setData]                 = useState<ApiResponse | null>(null)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [dialog, setDialog]             = useState<DialogState | null>(null)
  const [lastUpdated, setLastUpdated]   = useState<string | null>(null)
  const refreshTimer                    = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = useCallback(async (date: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/callback-eligibility?date=${date}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
      setLastUpdated(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData(selectedDate)
  }, [selectedDate, fetchData])

  // Auto-refresh every 5 min when viewing today
  useEffect(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current)
    if (selectedDate === todayStr()) {
      refreshTimer.current = setInterval(() => fetchData(selectedDate), 5 * 60 * 1000)
    }
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current) }
  }, [selectedDate, fetchData])

  function openCallback(member: Member, listType: string) {
    setDialog({ mode: 'callback', member, listType, fiscalYear: data?.fiscalYear ?? 0 })
  }

  function openCorrect(member: Member, listType: string) {
    setDialog({ mode: 'correct', member, listType, fiscalYear: data?.fiscalYear ?? 0 })
  }

  const btnBase: React.CSSProperties = {
    padding: '7px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600,
    cursor: 'pointer', border: '1px solid #374151',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      {/* Nav */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', borderBottom: '1px solid #1e1e1e', background: '#0d0d0d',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/" style={{ color: '#6b7280', fontSize: 13, textDecoration: 'none' }}>
            ◂ Crew Board
          </Link>
          <span style={{ color: '#333' }}>|</span>
          <Link href="/mot" style={{ color: '#6b7280', fontSize: 13, textDecoration: 'none' }}>
            MOT Eligibility
          </Link>
          <span style={{ color: '#333' }}>|</span>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Voluntary Callback
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setSelectedDate(todayStr())}
            style={{ ...btnBase, background: selectedDate === todayStr() ? '#1e3a5f' : '#1a1a1a', color: selectedDate === todayStr() ? '#60a5fa' : '#9ca3af' }}
          >
            Today
          </button>
          <button
            onClick={() => setSelectedDate(tomorrowStr())}
            style={{ ...btnBase, background: selectedDate === tomorrowStr() ? '#1e3a5f' : '#1a1a1a', color: selectedDate === tomorrowStr() ? '#60a5fa' : '#9ca3af' }}
          >
            Tomorrow
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            style={{
              background: '#1a1a1a', border: '1px solid #374151', borderRadius: 6,
              color: '#fff', padding: '6px 10px', fontSize: 13, cursor: 'pointer',
            }}
          />
          <button
            onClick={() => fetchData(selectedDate)}
            disabled={loading}
            style={{ ...btnBase, background: '#1a1a1a', color: '#9ca3af', fontSize: 16, padding: '6px 12px' }}
            title="Refresh"
          >
            ↺
          </button>
        </div>
      </nav>

      {/* Main */}
      <div style={{ padding: '20px 20px 40px' }}>
        {/* Date + FY header */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
              {data ? formatDisplayDate(data.shiftDate) : '—'}
            </h1>
            {data && (
              <span style={{ color: '#4b5563', fontSize: 13 }}>FY{data.fiscalYear}</span>
            )}
          </div>
          {lastUpdated && (
            <span style={{ color: '#4b5563', fontSize: 12 }}>
              Updated {lastUpdated} · auto-refresh 5 min
            </span>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div style={{
            background: '#3f1f1f', border: '1px solid #7f1d1d', borderRadius: 8,
            padding: '12px 16px', color: '#f87171', marginBottom: 16,
          }}>
            Error loading callback data: {error}
          </div>
        )}

        {/* Classification grid */}
        {data && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(560px, 1fr))', gap: 16 }}>
            {data.classifications.map(cls => (
              <ClassCard
                key={cls.listType}
                cls={cls}
                onCallback={openCallback}
                onCorrect={openCorrect}
              />
            ))}
          </div>
        )}
      </div>

      {/* Dialog */}
      {dialog && data && (
        <CallbackDialog
          dialog={dialog}
          fiscalYear={data.fiscalYear}
          onClose={() => setDialog(null)}
          onRefresh={() => fetchData(selectedDate)}
        />
      )}
    </div>
  )
}
