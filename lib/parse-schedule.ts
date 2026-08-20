/**
 * SFD Schedule PDF Parser
 *
 * Parses the text extracted from the SFD daily schedule PDF into structured
 * assignment rows ready for DB insertion.
 *
 * PDF text format (extracted via pdf-parse):
 *   Sat, August 15, 2026 — Schedule
 *   BC-3
 *   Staffing level: (0/1)
 *   08:00 - 08:00
 *   ENGINE 1 (503) 932-5692
 *   Staffing level: (4/3)
 *   08:00 - 08:00
 *    O    Taylor Jacobberger     CAPT       CB     C       P
 *    R    Jeremy Tinney     CAPT      P       CNFLG
 *   [Traded with ...]
 */

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

import type { AssignmentType } from './schedule/assignment-types'
import {
  standardShiftWindow,
  lightDutyShiftWindow,
  rangeShiftWindow,
} from './schedule/shift-window'

export type { AssignmentType }

export interface ParsedRow {
  /** DB apparatus_id, e.g. "E-1", "M-3", "BC-2" */
  apparatusId: string
  firstName: string
  lastName: string
  /** Raw name string from PDF for display */
  rawName: string
  assignmentType: AssignmentType
  isOt: boolean
  isHalfShift: boolean
  startDt: string   // ISO 8601
  endDt: string     // ISO 8601
  hoursScheduled: number
}

export interface ParseWarning {
  lineNum: number
  line: string
  reason: string
}

export interface ParseResult {
  shiftDate: string  // YYYY-MM-DD
  rows: ParsedRow[]
  warnings: ParseWarning[]
}

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

/** Type code → assignment_type */
const TYPE_MAP: Record<string, AssignmentType> = {
  R: 'regular',
  O: 'callback_voluntary',
  M: 'callback_mandatory',
  D: 'regular',      // debit day — paid as regular
  T: 'trade',
  S: 'ccc_intern',   // S = special / CCC contractor
  E: 'regular',      // extra / emergency
  V: 'regular',      // volunteer / misc
  L: 'light_duty',   // L = light duty / modified duty
}

/** Type codes that are overtime */
const OT_CODES = new Set(['O', 'M'])

/** Section titles that are NOT apparatus — skip them for staffing attribution */
const NON_APPARATUS_SECTIONS = new Set([
  'Debit Day Staffing',
  'Other Duties',
  'Other Duties ( CPR, SWAT, Etc)',
  'SHIFT FLOATERS',
  'Shift Trades',
  'Employees Off',
  'Misc',
  'Trade Participants',
])

/** Month name → zero-padded number */
const MONTH_MAP: Record<string, string> = {
  January: '01', February: '02', March: '03', April: '04',
  May: '05', June: '06', July: '07', August: '08',
  September: '09', October: '10', November: '11', December: '12',
}

// ────────────────────────────────────────────────────────────────
// Apparatus name → DB ID
// ────────────────────────────────────────────────────────────────

/**
 * Map a PDF apparatus label to the DB apparatus_id.
 * Returns null for unrecognized labels (non-apparatus sections, etc.)
 */
export function mapApparatusName(raw: string): string | null {
  // Strip phone numbers: (503) 932-5692  or  503-932-5692
  let n = raw
    .replace(/\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  // Remove trailing punctuation artifacts
  n = n.replace(/\s*\(.*\)\s*$/, '').trim()

  // BC formats: "BC-4", "BC 4", "BC4", "Battalion Chief 4", "Battalion 4"
  if (/^BC-\d+$/i.test(n)) return n.toUpperCase()
  const bcSpace  = n.match(/^BC\s+(\d+)$/i)
  if (bcSpace) return `BC-${bcSpace[1]}`
  const bcNoDash = n.match(/^BC(\d+)$/i)
  if (bcNoDash) return `BC-${bcNoDash[1]}`
  const batChief = n.match(/^BATTALION(?:\s+CHIEF)?\s+(\d+)$/i)
  if (batChief) return `BC-${batChief[1]}`

  // "Brush N" or "BRUSH N" → BR-N
  const brush = n.match(/^(?:Brush|BRUSH)\s+(\d+)$/i)
  if (brush) return `BR-${brush[1]}`

  // "ENGINE N" → E-N
  const engine = n.match(/^ENGINE\s+(\d+)$/i)
  if (engine) return `E-${engine[1]}`

  // "MEDIC N" → M-N
  const medic = n.match(/^MEDIC\s+(\d+)$/i)
  if (medic) return `M-${medic[1]}`

  // "TRUCK N" → TR-N
  const truck = n.match(/^TRUCK\s+(\d+)$/i)
  if (truck) return `TR-${truck[1]}`

  // "HARBOR N" or "HB-N" → HB-N
  if (/^HB-\d+$/i.test(n)) return n.toUpperCase()
  const harbor = n.match(/^HARBOR\s+(\d+)$/i)
  if (harbor) return `HB-${harbor[1]}`

  // Already "REACH-N", "DECON-N", "HM-N", "A-N" etc.
  if (/^(REACH|DECON|HM|A|BR|TR|HR|F|USAR)-[\dA-Z]+$/i.test(n)) return n.toUpperCase()

  // "ON Call DFM" / "ON Call DFM (Weekends)" → treat as placeholder; section handled separately
  if (/ON\s+Call\s+DFM/i.test(n)) return '__DFM__'

  // "Light Duty" / "LIGHT DUTY" / "Light Duty Mon-Thu" → virtual LD apparatus
  if (/^LIGHT\s+DUTY/i.test(n)) return 'LD'

  return null
}

/**
 * Given an engine/apparatus ID like "E-6", derive the co-located medic unit "M-6".
 * Returns null if inference isn't possible.
 */
function deriveCompanionMedic(lastApparatusId: string): string | null {
  const m = lastApparatusId.match(/^E-(\d+)$/)
  if (m) return `M-${m[1]}`
  return null
}

// ────────────────────────────────────────────────────────────────
// Employee line parsing
// ────────────────────────────────────────────────────────────────

/**
 * An employee line looks like:
 *   " R    Taylor Jacobberger     CAPT       CB     C       P   "
 *   " O    Bill O'Connell     CAPT       CB     P   "
 *   " R    Shawn Barnes 971-600-5041     BC     P   "
 *   " S    Edison Valasco Mendez    CCC   "
 *
 * Leading space + type code + 2+ spaces + name + 3+ spaces + rank + ...
 */
// Leading space is optional (pdfjs-dist v3 may not always include it).
// Single-space separators are allowed — v3 doesn't pad inter-item gaps.
const EMPLOYEE_LINE_RE =
  /^[ \t]?([ROMDTSEVL])\s+(.+?)\s+(?:CAPT|ENG\/P|FF\/P|MEDIC|EMT|BC|DFM|CCC|INTERN|FIRE|SRP|SRE)\s*/

/**
 * Fallback for entries where the rank field lands on a different PDF text item
 * (different Y) and doesn't appear on the same reconstructed line.
 * Examples:
 *   " R    Bob Schaffer  503-779-9380"  — BC/chief with no rank on line
 *   " T Christopher Frank"              — trade with rank on wrapped next line
 * Only used when EMPLOYEE_LINE_RE fails and we are inside a staffing block.
 * Requires 1+ space after type code; the single-char type code + immediate
 * whitespace is sufficient to distinguish from prose words like "Regular".
 */
const EMPLOYEE_LINE_RE_NO_RANK =
  /^[ \t]?([ROMDTSEVL])\s+(\S.*)/

/**
 * A continuation line follows a wrapped employee line — 2+ leading spaces, no type code.
 * "    CB     C       W/       P       CNFLG   "
 * "  FF/P     H       P       CNFLG   "  ← 2-space wrapped rank from some PDF renderings
 */
const CONTINUATION_LINE_RE = /^ {2,}(?!([ROMDTSEVL])\s{2,})/

/**
 * Inline time range embedded in the employee name field.
 * Examples: "08:00-17:00", "20:30 – 08:00", "17:00-20:30"
 */
const INLINE_TIME_RANGE_RE = /\b(\d{2}):(\d{2})\s*[-–]\s*(\d{2}):(\d{2})\b/

/**
 * Parse first/last name from the raw name field, stripping:
 *   - Parenthetical info: "(FM-3)", "(Trade Time [TR])"
 *   - Phone numbers
 *   - Trailing asterisks, daggers, or other annotation marks (e.g. "Cody Miller *")
 */
export function parseName(raw: string): { firstName: string; lastName: string } | null {
  const s = raw
    .replace(/\(.*?\)/g, '')                          // strip (...)
    .replace(/\d{3}[\-\s]?\d{3}[\-\s]?\d{4}/g, '')   // strip phone numbers
    .replace(/\b\d{2}:\d{2}\s*[-–]\s*\d{2}:\d{2}\b/g, '') // strip inline time ranges (07:00-17:00)
    .replace(/[*†‡#✓✗✘☑☒]+/g, '')                    // strip annotation marks (asterisks, etc.)
    .replace(/\s+/g, ' ')
    .trim()

  if (!s) return null
  const idx = s.indexOf(' ')
  if (idx < 0) return { firstName: s, lastName: '' }
  return {
    firstName: s.slice(0, idx).trim(),
    lastName: s.slice(idx + 1).trim(),
  }
}

// ────────────────────────────────────────────────────────────────
// Date / timestamp helpers
// ────────────────────────────────────────────────────────────────

function parseShiftDate(text: string): string {
  // "Sat, August 15, 2026 — Schedule"
  const m = text.match(/(\w+),\s+(\w+)\s+(\d{1,2}),\s+(\d{4})/)
  if (!m) return ''
  const [, , month, day, year] = m
  const mon = MONTH_MAP[month]
  if (!mon) return ''
  return `${year}-${mon}-${day.padStart(2, '0')}`
}

// Shift time-window math lives in lib/schedule/shift-window.ts so the PDF
// importer and the schedule builder's publish route produce identical
// start_dt / end_dt / hours_scheduled values.

// ────────────────────────────────────────────────────────────────
// Lookahead helper
// ────────────────────────────────────────────────────────────────

/**
 * Look ahead and check whether the upcoming staffing block contains L-coded
 * (light duty) employees. Used to auto-assign orphan L blocks to LD apparatus.
 */
function peekHasLightDuty(lines: string[], fromIndex: number): boolean {
  for (let j = fromIndex; j < Math.min(fromIndex + 20, lines.length); j++) {
    const line = lines[j]
    const trimmed = line.trim()
    if (/^Staffing level:/i.test(trimmed)) break
    if (!line.startsWith(' ') && mapApparatusName(trimmed) !== null) break
    if (/^[ \t]?L\s+/.test(line)) return true
  }
  return false
}

/**
 * Look ahead from `fromIndex` and check whether ALL employee lines in the
 * upcoming staffing block have MEDIC/EMT ranks (vs CAPT/ENG/FF).
 *
 * Returns true  → all employees are medic-rank → safe to infer companion medic.
 * Returns false → at least one engine-rank employee → do NOT infer.
 */
function peekAllMedicRanks(lines: string[], fromIndex: number): boolean {
  const ENGINE_RANKS = /\b(CAPT|ENG\/P|FF\/P|BC)\b/
  const MEDIC_RANKS  = /\b(MEDIC|EMT|SRP|SRE)\b/
  let foundAny = false

  for (let j = fromIndex; j < Math.min(fromIndex + 30, lines.length); j++) {
    const line = lines[j]
    const trimmed = line.trim()
    // Stop at next staffing block or apparatus header
    if (/^Staffing level:/i.test(trimmed)) break
    if (!line.startsWith(' ') && mapApparatusName(trimmed) !== null) break
    if (EMPLOYEE_LINE_RE.test(line)) {
      if (ENGINE_RANKS.test(line)) return false  // has engine crew → not medic-only
      if (MEDIC_RANKS.test(line)) foundAny = true
    }
  }

  return foundAny
}

/**
 * Look ahead and check whether the next staffing block contains ONLY HTML
 * trade-participant display lines (no real employee rows).
 *
 * These blocks look like:
 *   Staffing level: (7/7)
 *   08:00 - 08:00
 *   Wyatt Crofts<br /> <span
 *   class="smaller">08/17 17:00 - 08/17 20:30</span>
 *
 * When this is true we should NOT pop pendingApparatus — the block has no
 * parseable employees and the next real staffing block should still get the
 * apparatus we were expecting.
 */
function peekIsHtmlBlock(lines: string[], fromIndex: number): boolean {
  let foundHtml = false

  for (let j = fromIndex; j < Math.min(fromIndex + 25, lines.length); j++) {
    const line = lines[j]
    const trimmed = line.trim()
    if (!trimmed) continue

    // Stop at the next staffing block or an apparatus header
    if (/^Staffing level:/i.test(trimmed)) break
    if (!line.startsWith(' ') && !line.startsWith('\t') && mapApparatusName(trimmed) !== null) break

    // Skip the time range line that immediately follows a Staffing level line
    if (/^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}$/.test(trimmed)) continue

    // If there is any real employee line, this is NOT an HTML-only block
    if (EMPLOYEE_LINE_RE.test(line) || EMPLOYEE_LINE_RE_NO_RANK.test(line)) return false

    // HTML markers
    if (/<br|<span|<\/span|class=/.test(trimmed)) { foundHtml = true; continue }

    // Date-prefixed time ranges used in trade participant HTML: "08/17 17:00 - 08/17 20:30"
    if (/^\d{2}\/\d{2}\s+\d{2}:\d{2}\s*-/.test(trimmed)) { foundHtml = true; continue }

    // "Traded with" display lines
    if (/^Traded with /i.test(trimmed)) continue
  }

  return foundHtml
}

// ────────────────────────────────────────────────────────────────
// Main parser
// ────────────────────────────────────────────────────────────────

export function parseScheduleText(text: string): ParseResult {
  const shiftDate = parseShiftDate(text)
  const rows: ParsedRow[] = []
  const warnings: ParseWarning[] = []

  const lines = text.split('\n')

  /**
   * pendingApparatus: apparatus headers seen since the last staffing block.
   * When a staffing block starts, we pop the LAST pending apparatus as the
   * current one. Remaining pending entries had no staff.
   */
  const pendingApparatus: string[] = []

  /** Last recognized apparatus ID (used for orphan inference) */
  let lastApparatusId: string | null = null

  /**
   * Current non-apparatus section title (e.g. "ON Call DFM (Weekends)").
   * Used to infer apparatus for second staffing block in that section.
   */
  let currentSectionTitle: string | null = null

  /** Last unrecognized non-indented line — helps debug orphan blocks */
  let lastUnrecognizedHeader: string | null = null

  /** Whether we're inside a staffing block collecting employees */
  let inStaffing = false
  let currentApparatusId: string | null = null
  let currentIsHalfShift = false
  let currentIsLightDuty = false

  const warn = (i: number, line: string, reason: string) =>
    warnings.push({ lineNum: i + 1, line: line.trimEnd(), reason })

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trimEnd().replace(/\x0c/g, '').trim() // strip form feed

    // ── Skip empty lines ──────────────────────────────────────────
    if (!trimmed) continue

    // ── Staffing level line ───────────────────────────────────────
    if (/^Staffing level:/i.test(trimmed)) {
      // If actual count is 0, there are no employees — skip silently
      const staffActual = trimmed.match(/\((\d+)\/\d+\)/)
      if (staffActual && staffActual[1] === '0') {
        // Clear pending apparatus (they had no staff) but don't warn
        pendingApparatus.length = 0
        inStaffing = false
        currentApparatusId = null
        continue
      }

      // Determine if half-shift from the next non-empty line (the time range)
      let j = i + 1
      while (j < lines.length && !lines[j].trim()) j++
      const timeRange = j < lines.length ? lines[j].trim() : ''

      currentIsHalfShift = /08:00\s*-\s*18:00/.test(timeRange)

      // Determine which apparatus this block belongs to — must happen before light duty check

      // Check for HTML-only trade-participant display blocks FIRST.
      // These blocks contain no parseable employees (just rendered HTML showing who traded).
      // We must NOT pop pendingApparatus — the next real staffing block still needs it.
      if (peekIsHtmlBlock(lines, i + 1)) {
        inStaffing = false
        currentApparatusId = null
        // Leave pendingApparatus intact so the following real crew block gets the apparatus
        continue
      }

      if (pendingApparatus.length > 0) {
        // Normal case: pop the last pending apparatus
        currentApparatusId = pendingApparatus[pendingApparatus.length - 1]
        lastApparatusId = currentApparatusId
        pendingApparatus.length = 0
      } else {
        // Orphan block — no apparatus header since last staffing
        if (currentSectionTitle?.match(/ON\s+Call\s+DFM/i)) {
          // Apparatus resolved per-employee from (FM-N) call sign in the name field
          currentApparatusId = '__DFM_ONCALL__'
        } else if (peekHasLightDuty(lines, i + 1)) {
          // L-coded (light duty) block — assign to virtual LD apparatus
          currentApparatusId = 'LD'
          currentIsLightDuty = true
        } else if (lastApparatusId && peekAllMedicRanks(lines, i + 1)) {
          // Only use companion-medic inference when every employee is MEDIC/EMT rank
          const companion = deriveCompanionMedic(lastApparatusId)
          if (companion) {
            currentApparatusId = companion
          } else {
            currentApparatusId = null
            warn(i, trimmed, `Orphan medic staffing block; could not derive companion for ${lastApparatusId}. Skipping.`)
          }
        } else {
          // Engine-rank crew or unknown orphan — can't auto-assign; flag for user
          currentApparatusId = null
          warn(
            i,
            trimmed,
            `Orphan staffing block after ${lastApparatusId ?? '?'} — apparatus could not be determined. ` +
            `Last unrecognized header: "${lastUnrecognizedHeader ?? 'none'}". ` +
            `These rows will be skipped; assign them manually if needed.`,
          )
        }
      }

      // Light duty uses 07:00–17:00 timestamps instead of standard shift times
      currentIsLightDuty = currentApparatusId === 'LD' || /07:00\s*-\s*17:00/.test(timeRange)

      inStaffing = true
      continue
    }

    // ── Employee line ─────────────────────────────────────────────
    // Try strict match first (with rank keyword); fall back to no-rank pattern
    // for BC/chief entries where rank lands on a separate PDF text item.
    const empMatch = inStaffing && currentApparatusId
      ? (EMPLOYEE_LINE_RE.exec(raw) ?? EMPLOYEE_LINE_RE_NO_RANK.exec(raw))
      : null
    if (empMatch) {
      const match = empMatch
      const typeCode = match[1].toUpperCase()
      const rawName = match[2].trim()

      // Extract inline time range from the full raw line (time often appears AFTER the rank
      // field, not in the name portion). e.g.:
      //   " T    Wyatt Crofts     FF/P     17:00-20:30     P"  → rangeMatch on full line
      // Also handle split lines where pdfjs wraps the end time to the next line:
      //   " R    Nicholas Sines     FF/P     08:00-"   (line i)
      //   "17:00     P       CNFLG"                    (line i+1, a continuation)
      // We join up to 2 look-ahead characters from the next non-empty line to catch the split.
      const nextLineForRange = (() => {
        for (let k = i + 1; k < Math.min(i + 3, lines.length); k++) {
          const t = lines[k].trim()
          if (t) return t
        }
        return ''
      })()
      const fullLineForRange = raw + ' ' + nextLineForRange
      const rangeMatch = INLINE_TIME_RANGE_RE.exec(fullLineForRange)
      const inlineRange = rangeMatch ? {
        startHH: parseInt(rangeMatch[1]),
        startMM: parseInt(rangeMatch[2]),
        endHH:   parseInt(rangeMatch[3]),
        endMM:   parseInt(rangeMatch[4]),
      } : null

      // Resolve on-call DFM apparatus from (FM-N) call sign embedded in name field
      // e.g. "Justin Guinan (FM-3) 503-932-5718" → DFM-3
      let resolvedApparatusId = currentApparatusId
      if (currentApparatusId === '__DFM_ONCALL__') {
        const fmMatch = rawName.match(/\(FM-(\d+)\)/i)
        resolvedApparatusId = fmMatch ? `DFM-${fmMatch[1]}` : 'DFM-1'
      }

      const nameResult = parseName(rawName)
      if (!nameResult) {
        warn(i, raw.trimEnd(), 'Could not parse name from employee line')
        continue
      }

      const { firstName, lastName } = nameResult
      // Light duty overrides whatever type code the PDF used
      const assignmentType: AssignmentType = currentIsLightDuty
        ? 'light_duty'
        : (TYPE_MAP[typeCode] ?? 'regular')
      const isOt = OT_CODES.has(typeCode)
      // Priority: light_duty fixed window > inline PDF range > default shift timestamps
      const timestamps = currentIsLightDuty
        ? lightDutyShiftWindow(shiftDate)
        : inlineRange
          ? rangeShiftWindow(shiftDate, inlineRange.startHH, inlineRange.startMM, inlineRange.endHH, inlineRange.endMM)
          : standardShiftWindow(shiftDate, currentIsHalfShift)

      rows.push({
        apparatusId: resolvedApparatusId,
        firstName,
        lastName,
        rawName,
        assignmentType,
        isOt,
        isHalfShift: currentIsHalfShift,
        ...timestamps,
      })
      continue
    }

    // ── Continuation line (wrapped employee details) ──────────────
    if (inStaffing && CONTINUATION_LINE_RE.test(raw) && !EMPLOYEE_LINE_RE.test(raw)) {
      // e.g. "    CB     C       W/       P       CNFLG   " — just skip
      continue
    }

    // ── "Traded with ..." lines ───────────────────────────────────
    if (/^Traded with /i.test(trimmed)) continue

    // ── Time range line (after staffing level) ────────────────────
    if (/^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}$/.test(trimmed)) continue

    // ── HTML fragment (trade participant section) ─────────────────
    if (/<br|<span|<\/span|class=/.test(trimmed)) continue
    if (/^\d{2}\/\d{2}\s+\d{2}:\d{2}\s*-/.test(trimmed)) continue

    // ── Potential apparatus header ────────────────────────────────
    // Must start at column 0 (no leading space) after stripping form feed
    if (!raw.startsWith(' ') && !raw.startsWith('\t')) {
      // Skip known non-apparatus sections
      const isNonApparatus =
        [...NON_APPARATUS_SECTIONS].some(s => trimmed.startsWith(s)) ||
        /^Employees Off/i.test(trimmed) ||
        /^Misc\s*$/.test(trimmed) ||
        /<\w+/.test(trimmed)  // HTML tags

      if (isNonApparatus) {
        // Still capture section title for DFM inference
        currentSectionTitle = trimmed
        // This ends any current staffing block
        inStaffing = false
        currentApparatusId = null
        continue
      }

      const mapped = mapApparatusName(trimmed)
      if (mapped) {
        // This is a recognized apparatus header
        if (mapped === '__DFM__') {
          // Treat "ON Call DFM" as a section title, not an apparatus
          currentSectionTitle = trimmed
        } else {
          pendingApparatus.push(mapped)
          currentSectionTitle = null
        }
        inStaffing = false
        currentApparatusId = null
        currentIsLightDuty = false
      }
      // Unrecognized non-indented line: could be a section header we don't know
      // Track it so orphan warnings can report what preceded the block
      if (!mapped) lastUnrecognizedHeader = trimmed
    }
  }

  return { shiftDate, rows, warnings }
}
