/**
 * /schedule
 *
 * Schedule index — date picker that navigates to /schedule/[date].
 * Shows upcoming shift letter for today + the next 7 days
 * (pulled from shift_calendar).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import { TABLES } from '@/lib/db/tables'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function todayLocal(): string {
  // Use Intl to get today's date in Salem, OR (America/Los_Angeles)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
}

async function getUpcomingShifts(startDate: string, days: number) {
  const supabase = createAdminClient()
  const end = new Date(startDate)
  end.setDate(end.getDate() + days - 1)
  const endDate = end.toISOString().slice(0, 10)

  const { data } = await supabase
    .from(TABLES.shiftCalendar)
    .select('shift_date, shift_letter')
    .gte('shift_date', startDate)
    .lte('shift_date', endDate)
    .order('shift_date')

  return data ?? []
}

const SHIFT_COLORS: Record<string, string> = {
  A: 'text-red-400 border-red-700/40 bg-red-900/10 hover:bg-red-900/20',
  B: 'text-blue-400 border-blue-700/40 bg-blue-900/10 hover:bg-blue-900/20',
  C: 'text-green-400 border-green-700/40 bg-green-900/10 hover:bg-green-900/20',
  D: 'text-yellow-400 border-yellow-700/40 bg-yellow-900/10 hover:bg-yellow-900/20',
}

export default async function ScheduleIndexPage() {
  const today = todayLocal()
  const upcoming = await getUpcomingShifts(today, 14)

  return (
    <div className="min-h-screen bg-[#060f1a] text-zinc-200">
      <div className="max-w-2xl mx-auto px-4 py-8">

        <div className="mb-8">
          <h1 className="text-xl font-mono font-bold text-zinc-100 tracking-widest uppercase mb-1">
            Daily Schedule Builder
          </h1>
          <p className="text-zinc-500 font-mono text-sm">
            Select a date to build the daily assignment roster.
          </p>
        </div>

        {/* Upcoming dates */}
        <div className="space-y-2">
          {upcoming.length === 0 ? (
            <div className="text-zinc-600 font-mono text-sm italic">
              No shift calendar data found. Run shift-roster-seed.sql in Supabase.
            </div>
          ) : (
            upcoming.map(({ shift_date, shift_letter }) => {
              const isToday = shift_date === today
              const d = new Date(shift_date + 'T12:00:00')
              const label = d.toLocaleDateString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric',
              })
              const shiftClass = SHIFT_COLORS[shift_letter] ?? 'text-zinc-400 border-zinc-700 bg-zinc-900/10 hover:bg-zinc-900/20'

              return (
                <Link
                  key={shift_date}
                  href={`/schedule/${shift_date}`}
                  className={`flex items-center gap-4 px-4 py-3 rounded-lg border transition-colors ${shiftClass}`}
                >
                  <span className={`font-mono font-bold text-base w-6 text-center`}>
                    {shift_letter}
                  </span>
                  <span className="font-mono text-sm text-zinc-200 flex-1">
                    {label}
                  </span>
                  {isToday && (
                    <span className="text-[10px] font-mono font-bold text-zinc-400 border border-zinc-600 rounded px-1.5 py-0.5">
                      TODAY
                    </span>
                  )}
                  <span className="text-zinc-600 text-xs font-mono">{shift_date}</span>
                </Link>
              )
            })
          )}
        </div>

        {/* Navigation back */}
        <div className="mt-8 pt-6 border-t border-zinc-800">
          <Link href="/crew-board" className="text-zinc-500 hover:text-zinc-300 font-mono text-sm">
            ← Crew Board
          </Link>
        </div>
      </div>
    </div>
  )
}
