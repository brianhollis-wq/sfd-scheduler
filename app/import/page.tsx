'use client'

/**
 * SFD Schedule Import — /import
 *
 * 1. Upload a daily schedule PDF (the same PDF you'd normally send to Brian)
 * 2. Review the parsed preview — green rows matched an employee, red rows didn't
 * 3. Click "Commit to Database" to replace that shift's assignments
 */

import { useState, useRef, useTransition } from 'react'
import { commitScheduleAction, PreviewRow } from './actions'

interface ParseWarning { lineNum: number; reason: string }

// ────────────────────────────────────────────────────────────────
// Helpers / constants
// ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  regular:              { label: 'Regular',   color: 'text-zinc-300' },
  callback_voluntary:   { label: 'OT',        color: 'text-yellow-400' },
  callback_mandatory:   { label: 'Mandatory', color: 'text-orange-400' },
  trade:                { label: 'Trade',     color: 'text-sky-400' },
}

function formatDate(isoDate: string): string {
  if (!isoDate) return ''
  const [year, month, day] = isoDate.split('-')
  const d = new Date(Number(year), Number(month) - 1, Number(day))
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

// ────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────

function Badge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-xs font-mono font-semibold ${className}`}
    >
      {children}
    </span>
  )
}

function WarningBanner({ warnings }: { warnings: ParseWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-900/20 px-4 py-3">
      <p className="text-xs font-semibold text-amber-400 mb-2">
        ⚠ {warnings.length} warning{warnings.length !== 1 ? 's' : ''} from parser
      </p>
      <ul className="space-y-1">
        {warnings.map((w, i) => (
          <li key={i} className="text-xs text-amber-300/80 font-mono">
            Line {w.lineNum}: {w.reason}
          </li>
        ))}
      </ul>
    </div>
  )
}

function PreviewTable({
  rows,
  shiftDate,
}: {
  rows: PreviewRow[]
  shiftDate: string
}) {
  const matched   = rows.filter((r) => r.matched)
  const unmatched = rows.filter((r) => !r.matched)

  return (
    <div className="mt-6 space-y-4">
      {/* Summary counts */}
      <div className="flex items-center gap-4 text-sm">
        <span className="text-zinc-400">
          <span className="text-white font-semibold">{rows.length}</span> assignments parsed
          &nbsp;—&nbsp;
          <span className="text-emerald-400 font-semibold">{matched.length}</span> matched&nbsp;
          <span className="text-red-400 font-semibold">{unmatched.length}</span> unmatched
        </span>
        <span className="text-zinc-600">|</span>
        <span className="text-zinc-400">{formatDate(shiftDate)}</span>
      </div>

      {/* Main table */}
      <div className="overflow-x-auto rounded-lg border border-zinc-700/50">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-zinc-700/50 bg-zinc-800/50">
              <th className="px-3 py-2 text-left text-zinc-500 font-medium w-8">#</th>
              <th className="px-3 py-2 text-left text-zinc-500 font-medium">Unit</th>
              <th className="px-3 py-2 text-left text-zinc-500 font-medium">Type</th>
              <th className="px-3 py-2 text-left text-zinc-500 font-medium">Name (PDF)</th>
              <th className="px-3 py-2 text-left text-zinc-500 font-medium">Employee (DB)</th>
              <th className="px-3 py-2 text-left text-zinc-500 font-medium">Hours</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const typeInfo = TYPE_LABELS[row.assignmentType] ?? { label: row.assignmentType, color: 'text-zinc-400' }
              const isMatch  = row.matched
              return (
                <tr
                  key={idx}
                  className={`border-b border-zinc-800/50 ${
                    isMatch ? 'hover:bg-zinc-800/30' : 'bg-red-950/20 hover:bg-red-950/30'
                  }`}
                >
                  <td className="px-3 py-1.5 text-zinc-600">{idx + 1}</td>
                  <td className="px-3 py-1.5">
                    <span className="text-white font-semibold">{row.apparatusId}</span>
                    {row.isHalfShift && (
                      <span className="ml-1 text-sky-500/70 text-[10px]">½</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={typeInfo.color}>{typeInfo.label}</span>
                    {row.isOt && (
                      <span className="ml-1 text-[10px] text-yellow-500/60">OT</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-zinc-300">{row.rawName}</td>
                  <td className="px-3 py-1.5">
                    {isMatch ? (
                      <span className="text-emerald-400">
                        ✓ {row.employeeDisplay}
                      </span>
                    ) : (
                      <span className="text-red-400">
                        ✗ No match — {row.firstName} {row.lastName}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-zinc-500">{row.hoursScheduled}h</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Unmatched legend */}
      {unmatched.length > 0 && (
        <p className="text-xs text-red-400/70">
          ✗ Unmatched rows will be skipped on commit. Check the employee&apos;s name spelling in the DB.
        </p>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
// Main page component
// ────────────────────────────────────────────────────────────────

type PageState =
  | { phase: 'idle' }
  | { phase: 'parsing' }
  | { phase: 'preview'; shiftDate: string; rows: PreviewRow[]; warnings: ParseWarning[]; debugLines?: string[] }
  | { phase: 'committing' }
  | { phase: 'done'; inserted: number; skipped: number; shiftDate: string;
      unmatchedPdf?: string[]; unmatchedRoster?: string[]; missingApparatus?: string[] }
  | { phase: 'error'; message: string }

export default function ImportPage() {
  const [state, setState] = useState<PageState>({ phase: 'idle' })
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [, startTransition] = useTransition()

  // ── File upload handling ──────────────────────────────────────

  async function handleFile(file: File) {
    if (!file.name.endsWith('.pdf')) {
      setState({ phase: 'error', message: 'Please upload a PDF file.' })
      return
    }

    setState({ phase: 'parsing' })

    const formData = new FormData()
    formData.append('pdf', file)

    startTransition(async () => {
      try {
        const response = await fetch('/api/parse-pdf', { method: 'POST', body: formData })
        const result = await response.json()
        if (result.error) {
          setState({ phase: 'error', message: result.error })
        } else {
          setState({
            phase: 'preview',
            shiftDate: result.shiftDate,
            rows: result.rows,
            warnings: result.warnings ?? [],
            debugLines: result.debugLines,
          })
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        setState({ phase: 'error', message: `Upload failed: ${msg}` })
      }
    })
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  // ── Commit ────────────────────────────────────────────────────

  async function handleCommit() {
    if (state.phase !== 'preview') return
    const { shiftDate, rows } = state

    setState({ phase: 'committing' })
    startTransition(async () => {
      const result = await commitScheduleAction(shiftDate, rows)
      if (result.error) {
        setState({ phase: 'error', message: result.error })
      } else {
        setState({
          phase: 'done',
          inserted: result.inserted,
          skipped: result.skipped,
          shiftDate,
          unmatchedPdf: result.unmatchedPdf,
          unmatchedRoster: result.unmatchedRoster,
          missingApparatus: result.missingApparatus,
        })
      }
    })
  }

  // ── Reset ─────────────────────────────────────────────────────

  function reset() {
    setState({ phase: 'idle' })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#091520] text-zinc-200 font-mono">
      <div className="max-w-5xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
            >
              ← Board
            </a>
            <span className="text-zinc-700">|</span>
            <h1 className="text-xl font-bold text-white tracking-tight">
              SFD Schedule Import
            </h1>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            Upload a daily schedule PDF to preview and commit crew assignments.
          </p>
        </div>

        {/* ── IDLE / UPLOAD ────────────────────────────────── */}
        {(state.phase === 'idle' || state.phase === 'error') && (
          <div className="space-y-4">
            {/* Drop zone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              className={`
                relative cursor-pointer rounded-xl border-2 border-dashed px-8 py-16
                text-center transition-colors
                ${isDragging
                  ? 'border-sky-500 bg-sky-950/30'
                  : 'border-zinc-700 hover:border-zinc-500 bg-zinc-900/30 hover:bg-zinc-900/50'}
              `}
            >
              <div className="text-4xl mb-3 select-none">📄</div>
              <p className="text-zinc-300 font-semibold">
                Drop schedule PDF here
              </p>
              <p className="text-zinc-500 text-sm mt-1">
                or click to browse
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={onFileChange}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </div>

            {/* Instructions */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3 text-xs text-zinc-500 space-y-1">
              <p className="text-zinc-400 font-semibold">How it works</p>
              <p>1. Upload the daily schedule PDF (e.g. <span className="text-zinc-300">schedulesat08152026.pdf</span>)</p>
              <p>2. Review the parsed preview — check that names matched correctly</p>
              <p>3. Click <span className="text-white">Commit to Database</span> to replace existing assignments for that shift date</p>
              <p className="text-amber-500/80 pt-1">⚠ Committing will delete and replace ALL assignments for the detected shift date.</p>
            </div>

            {/* Error */}
            {state.phase === 'error' && (
              <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3">
                <p className="text-red-400 text-sm font-semibold">Error</p>
                <p className="text-red-300/80 text-sm mt-1">{state.message}</p>
              </div>
            )}
          </div>
        )}

        {/* ── PARSING ──────────────────────────────────────── */}
        {state.phase === 'parsing' && (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-zinc-500">
            <div className="animate-spin text-3xl">⚙</div>
            <p className="text-sm">Parsing PDF…</p>
          </div>
        )}

        {/* ── PREVIEW ──────────────────────────────────────── */}
        {state.phase === 'preview' && (
          <div>
            {/* Action bar */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Badge className="bg-emerald-900/50 text-emerald-400 border border-emerald-700/40">
                  {state.shiftDate}
                </Badge>
                <span className="text-zinc-500 text-sm">{formatDate(state.shiftDate)}</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={reset}
                  className="px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 transition-colors"
                >
                  ← Upload different PDF
                </button>
                <button
                  onClick={handleCommit}
                  className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-emerald-700 hover:bg-emerald-600 text-white transition-colors"
                >
                  Commit to Database
                </button>
              </div>
            </div>

            <WarningBanner warnings={state.warnings} />

            {/* Debug panel — only shown when 0 rows parsed */}
            {state.rows.length === 0 && state.debugLines && (
              <div className="mt-4 rounded-lg border border-sky-700/40 bg-sky-950/20 p-4">
                <p className="text-xs font-semibold text-sky-400 mb-2">
                  ⚙ Debug: first 60 lines of extracted text (0 rows parsed — check format below)
                </p>
                <pre className="text-xs text-sky-300/70 font-mono overflow-x-auto max-h-96 overflow-y-auto whitespace-pre">
                  {state.debugLines.map((l, i) => `L${String(i).padStart(3, '0')}: ${JSON.stringify(l)}`).join('\n')}
                </pre>
              </div>
            )}

            <PreviewTable rows={state.rows} shiftDate={state.shiftDate} />

            {/* Second commit button at bottom for long tables */}
            {state.rows.length > 20 && (
              <div className="mt-6 flex justify-end">
                <button
                  onClick={handleCommit}
                  className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-emerald-700 hover:bg-emerald-600 text-white transition-colors"
                >
                  Commit to Database
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── COMMITTING ───────────────────────────────────── */}
        {state.phase === 'committing' && (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-zinc-500">
            <div className="animate-spin text-3xl">💾</div>
            <p className="text-sm">Writing to database…</p>
          </div>
        )}

        {/* ── DONE ─────────────────────────────────────────── */}
        {state.phase === 'done' && (
          <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/30 px-8 py-12 text-center space-y-4">
            <div className="text-4xl">✅</div>
            <p className="text-xl font-semibold text-white">
              {state.inserted} assignment{state.inserted !== 1 ? 's' : ''} committed
            </p>
            <p className="text-zinc-400 text-sm">
              {formatDate(state.shiftDate)} — {state.shiftDate}
              {state.skipped > 0 && (
                <span className="text-amber-400">
                  &nbsp;({state.skipped} unmatched skipped)
                </span>
              )}
            </p>
            {/* Names the PDF listed that no employee record matched. The row is
                dropped, so the person is simply absent from the board — name
                them here rather than leaving it to the skipped count. */}
            {state.unmatchedPdf?.length ? (
              <div className="mx-auto max-w-md text-left rounded-lg border border-amber-700/40 bg-amber-950/30 px-4 py-3">
                <p className="text-amber-300 text-xs font-semibold uppercase tracking-wider">
                  On the schedule but not in employees
                </p>
                <ul className="text-amber-200/80 text-xs mt-1 space-y-0.5">
                  {state.unmatchedPdf.map(n => <li key={n}>· {n}</li>)}
                </ul>
                <p className="text-amber-200/50 text-[11px] pt-2 mt-2 border-t border-amber-800/30">
                  These were not committed and will not appear on the board. Add the
                  spelling the schedule uses to name_aliases, or fix the employee record.
                </p>
              </div>
            ) : null}
            {/* Permanent-roster problems. These people and units are never in
                the PDF, so nothing else would reveal that they went missing. */}
            {(state.unmatchedRoster?.length || state.missingApparatus?.length) ? (
              <div className="mx-auto max-w-md text-left rounded-lg border border-amber-700/40 bg-amber-950/30 px-4 py-3 space-y-2">
                {state.unmatchedRoster?.length ? (
                  <div>
                    <p className="text-amber-300 text-xs font-semibold uppercase tracking-wider">
                      Not found in employees
                    </p>
                    <ul className="text-amber-200/80 text-xs mt-1 space-y-0.5">
                      {state.unmatchedRoster.map(n => <li key={n}>· {n}</li>)}
                    </ul>
                  </div>
                ) : null}
                {state.missingApparatus?.length ? (
                  <div>
                    <p className="text-amber-300 text-xs font-semibold uppercase tracking-wider">
                      Apparatus not in database
                    </p>
                    <p className="text-amber-200/80 text-xs mt-1">
                      {state.missingApparatus.join(', ')}
                    </p>
                  </div>
                ) : null}
                <p className="text-amber-200/50 text-[11px] pt-1 border-t border-amber-800/30">
                  These are permanent-roster assignments — they are not in the PDF and were
                  not committed. Everything else imported normally.
                </p>
              </div>
            ) : null}

            <div className="flex justify-center gap-3 pt-2">
              <a
                href="/"
                className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-200 transition-colors"
              >
                View Board
              </a>
              <button
                onClick={reset}
                className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-200 transition-colors"
              >
                Import Another Shift
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
