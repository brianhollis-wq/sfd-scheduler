'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

interface Props {
  selectedDate: string   // YYYY-MM-DD
  activeTab:    string   // 'apparatus' | 'personnel'
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]
const DAY_LABELS = ['Su','Mo','Tu','We','Th','Fr','Sa']

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}

function formatDisplay(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short',
    month:   'short',
    day:     'numeric',
    year:    'numeric',
    timeZone: 'UTC',
  })
}

export default function DateNavClient({ selectedDate, activeTab }: Props) {
  const router   = useRouter()
  const calRef   = useRef<HTMLDivElement>(null)
  const [showCal,  setShowCal]  = useState(false)
  const [calMonth, setCalMonth] = useState(selectedDate.slice(0, 7)) // 'YYYY-MM'

  const today = todayISO()

  // Close calendar on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (calRef.current && !calRef.current.contains(e.target as Node)) {
        setShowCal(false)
      }
    }
    if (showCal) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showCal])

  function go(date: string, tab?: string) {
    router.push(`/crew-board?date=${date}&tab=${tab ?? activeTab}`)
  }

  function changeTab(tab: string) {
    router.push(`/crew-board?date=${selectedDate}&tab=${tab}`)
  }

  // Build month grid
  const [calYear, calMon] = calMonth.split('-').map(Number)
  const firstDow  = new Date(Date.UTC(calYear, calMon - 1, 1)).getUTCDay()
  const daysInMon = new Date(Date.UTC(calYear, calMon, 0)).getUTCDate()
  const cells: string[] = [
    ...Array(firstDow).fill(''),
    ...Array.from({ length: daysInMon }, (_, i) =>
      `${calYear}-${String(calMon).padStart(2,'0')}-${String(i + 1).padStart(2,'0')}`
    ),
  ]

  function shiftMonth(delta: number) {
    const d = new Date(Date.UTC(calYear, calMon - 1 + delta, 1))
    setCalMonth(d.toISOString().slice(0, 7))
  }

  return (
    <div className="border-b border-zinc-800 bg-[#0a1a28]">
      <div className="max-w-screen-2xl mx-auto px-6 py-2.5 flex items-center justify-between flex-wrap gap-3">

        {/* ── Date navigation ── */}
        <div className="relative flex items-center gap-2" ref={calRef}>
          <button
            onClick={() => go(addDays(selectedDate, -1))}
            className="text-zinc-400 hover:text-white font-mono text-[11px] px-2.5 py-1.5
              border border-zinc-700 hover:border-zinc-500 rounded transition-colors"
          >
            ◀ PREV
          </button>

          {/* Date button — opens calendar */}
          <button
            onClick={() => setShowCal(v => !v)}
            className={`
              flex items-center gap-2 font-mono text-sm px-4 py-1.5 rounded transition-colors
              border min-w-[230px] justify-center
              ${showCal
                ? 'border-[#c9a84c] text-white bg-[#c9a84c]/10'
                : 'border-[#c9a84c]/40 text-white hover:border-[#c9a84c]'}
            `}
          >
            <span className="text-[#c9a84c] text-xs">📅</span>
            <span className="tracking-wide">{formatDisplay(selectedDate)}</span>
            {selectedDate === today && (
              <span className="text-[9px] font-bold text-green-400 tracking-widest ml-1">TODAY</span>
            )}
          </button>

          <button
            onClick={() => go(addDays(selectedDate, 1))}
            className="text-zinc-400 hover:text-white font-mono text-[11px] px-2.5 py-1.5
              border border-zinc-700 hover:border-zinc-500 rounded transition-colors"
          >
            NEXT ▶
          </button>

          {selectedDate !== today && (
            <button
              onClick={() => go(today)}
              className="text-[10px] font-mono font-bold text-[#c9a84c] hover:text-white
                tracking-widest px-2 py-1.5 border border-[#c9a84c]/30 hover:border-[#c9a84c]
                rounded transition-colors"
            >
              TODAY
            </button>
          )}

          {/* ── Calendar dropdown ── */}
          {showCal && (
            <div className="absolute left-0 top-full mt-2 z-50
              bg-[#0a1a28] border border-[#c9a84c]/30 rounded-xl shadow-2xl shadow-black/60 p-4 w-72"
            >
              {/* Month navigator */}
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => shiftMonth(-1)}
                  className="text-zinc-400 hover:text-white font-mono text-xs w-8 h-8
                    flex items-center justify-center rounded hover:bg-zinc-800 transition-colors"
                >◀</button>
                <span className="font-mono font-bold text-sm text-white tracking-wider">
                  {MONTH_NAMES[calMon - 1]} {calYear}
                </span>
                <button
                  onClick={() => shiftMonth(1)}
                  className="text-zinc-400 hover:text-white font-mono text-xs w-8 h-8
                    flex items-center justify-center rounded hover:bg-zinc-800 transition-colors"
                >▶</button>
              </div>

              {/* Day-of-week headers */}
              <div className="grid grid-cols-7 mb-1">
                {DAY_LABELS.map(d => (
                  <div key={d} className="text-center text-[10px] font-mono font-bold text-zinc-600 py-1">{d}</div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7 gap-0.5">
                {cells.map((cell, i) => {
                  if (!cell) return <div key={`e${i}`} />
                  const isSel = cell === selectedDate
                  const isTod = cell === today
                  return (
                    <button
                      key={cell}
                      onClick={() => { go(cell); setShowCal(false) }}
                      className={`
                        text-center text-xs font-mono py-1.5 rounded transition-colors
                        ${isSel
                          ? 'bg-[#c9a84c] text-[#091520] font-bold'
                          : isTod
                          ? 'border border-[#c9a84c]/50 text-[#c9a84c] font-semibold'
                          : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}
                      `}
                    >
                      {new Date(cell + 'T12:00:00Z').getUTCDate()}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Tab switcher ── */}
        <div className="flex items-center gap-1 border border-zinc-700 rounded-lg p-0.5">
          {[
            { id: 'apparatus', label: 'Apparatus View' },
            { id: 'personnel', label: 'Personnel View' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => changeTab(tab.id)}
              className={`
                text-[10px] font-mono font-bold tracking-widest uppercase
                px-3 py-1.5 rounded transition-colors
                ${activeTab === tab.id
                  ? 'bg-[#c9a84c] text-[#091520]'
                  : 'text-zinc-500 hover:text-zinc-300'}
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
