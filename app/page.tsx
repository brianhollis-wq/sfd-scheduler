import Link from 'next/link'
import Image from 'next/image'

const BOARDS = [
  {
    href:        '/crew-board',
    title:       'Crew Board',
    description: 'Daily shift assignments — apparatus, positions, and personnel.',
    accent:      'border-l-red-600',
  },
  {
    href:        '/mot',
    title:       'MOT Eligibility',
    description: 'Mandatory overtime list ranked by position. Tracks eligibility and leave status.',
    accent:      'border-l-amber-500',
  },
  {
    href:        '/callback',
    title:       'Callback Eligibility',
    description: 'Voluntary callback lists for Captain, Engineer, FF/Paramedic, SR Paramedic, and SR EMT.',
    accent:      'border-l-blue-500',
  },
  {
    href:        '/debit-days',
    title:       'Debit Days',
    description: 'Debit shift schedule through end of fiscal year — by date and by person.',
    accent:      'border-l-purple-500',
  },
  {
    href:        '/schedule',
    title:       'Schedule Builder',
    description: 'Build daily assignments from the shift roster. Mark absences, add callbacks, and publish.',
    accent:      'border-l-green-600',
  },
]

function getDateString() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month:   'long',
    day:     'numeric',
    year:    'numeric',
    timeZone: 'America/Los_Angeles',
  })
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans">

      {/* Header */}
      <header className="bg-neutral-900 border-b border-neutral-800">
        <div className="max-w-4xl mx-auto px-6 py-10 flex flex-col items-center gap-5">
          <Image
            src="/sfd-logo.png"
            alt="Salem Fire Department"
            width={120}
            height={120}
            className="drop-shadow-lg"
            priority
          />
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-widest uppercase text-white">
              Salem Fire Department
            </h1>
            <p className="text-neutral-400 text-sm tracking-wider uppercase mt-1">
              Shift Operations
            </p>
            <p className="text-neutral-600 text-xs mt-3">{getDateString()}</p>
          </div>
        </div>
      </header>

      {/* Divider */}
      <div className="h-px bg-red-700 opacity-60" />

      {/* Boards */}
      <main className="max-w-4xl mx-auto px-6 py-10">
        <p className="text-neutral-500 text-xs uppercase tracking-widest mb-6 font-medium">
          Operations Boards
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {BOARDS.map(board => (
            <Link
              key={board.href}
              href={board.href}
              className={`
                group flex items-start gap-4 rounded-lg
                bg-neutral-900 border border-neutral-800
                border-l-4 ${board.accent}
                px-5 py-5
                hover:bg-neutral-800 hover:border-neutral-700
                transition-colors duration-100
              `}
            >
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold text-white uppercase tracking-wide">
                  {board.title}
                </h2>
                <p className="text-xs text-neutral-500 mt-1.5 leading-relaxed">
                  {board.description}
                </p>
              </div>
              <span className="text-neutral-600 group-hover:text-neutral-400 transition-colors mt-0.5 text-sm shrink-0">
                →
              </span>
            </Link>
          ))}
        </div>

        <p className="text-neutral-700 text-xs mt-10 text-center tracking-wide">
          Fiscal Year July 1 – June 30 &nbsp;·&nbsp; Shifts A · B · C · D
        </p>
      </main>
    </div>
  )
}
