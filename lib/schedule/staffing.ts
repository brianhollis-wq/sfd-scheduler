/**
 * Minimum staffing by seat, not just by headcount.
 *
 * A unit is not properly staffed merely because enough bodies are aboard. An
 * engine needs a captain, an apparatus operator and a firefighter; a medic
 * needs one single-role paramedic and one single-role EMT. Three firefighters
 * on an engine is three people and still no officer, and a plain count reports
 * that as fully staffed.
 *
 * CCC interns never fill a seat. They ride for accountability and are listed as
 * such, so an intern's absence leaves no vacancy to fill — that follows from
 * ccc_intern not being an on-duty type, so countsForStaffing() already excludes
 * them and nothing here has to special-case it.
 */

import { countsForStaffing } from './assignment-types'

// ── Seats ─────────────────────────────────────────────────────────────────────

export interface Seat {
  /** Shown on the board when the seat is open. */
  label: string
  /** employees.rank values that may fill it. */
  ranks: readonly string[]
  /** When set, the member must also be paramedic-certified. */
  requiresParamedic?: boolean
}

/**
 * Ranks that are paramedic-qualified by definition, whatever the is_paramedic
 * flag happens to say. Single-role paramedics and dual-role FF/Paramedics are
 * paramedics by rank; apparatus operators and captains vary by person, so for
 * those the flag decides.
 */
const PARAMEDIC_BY_RANK = new Set(['SRP', 'FF_PM', 'Probationary_PM'])

function isParamedicQualified(member: CrewMemberForStaffing): boolean {
  return member.isParamedic === true
      || (member.rank != null && PARAMEDIC_BY_RANK.has(member.rank))
}

const CAPTAIN: Seat = { label: 'CPT', ranks: ['Captain'] }
const OPERATOR: Seat = { label: 'AO',  ranks: ['FAO'] }
const FIREFIGHTER: Seat = {
  label: 'FF',
  // A paramedic-qualified firefighter and a probationary firefighter both fill
  // the firefighter seat; the distinction matters for pay and assignment, not
  // for whether the seat is covered.
  ranks: ['FF', 'FF_PM', 'Probationary_FF', 'Probationary_PM'],
}
/**
 * Medic seats, and who may cover them.
 *
 * The standard crew is one single-role paramedic and one single-role EMT.
 * Someone in another classification may cover a seat only at that seat's EMS
 * level or higher.
 *
 * Every firefighter and apparatus operator is a paramedic, so both cover either
 * seat. Captains vary: a captain who is a paramedic covers the paramedic seat,
 * one certified only to EMT covers the EMT seat alone. That distinction comes
 * from the member's own record rather than their rank, which is why the
 * paramedic seat tests certification and not just the rank list.
 *
 * A single-role EMT covers only the EMT seat — an EMT cannot work as a
 * paramedic.
 */
const PARAMEDIC: Seat = {
  label: 'PM',
  ranks: ['SRP', 'Probationary_PM', 'FF_PM', 'FAO', 'Captain'],
  requiresParamedic: true,
}
const EMT: Seat = {
  label: 'EMT',
  ranks: ['SRE', 'SRP', 'Probationary_PM', 'FF_PM', 'FAO', 'Captain'],
}
const BATTALION_CHIEF: Seat = { label: 'BC', ranks: ['BC'] }

/**
 * Required seats per apparatus type.
 *
 * Keyed by both vocabularies in use: the apparatus table's `type` column
 * (engine, ladder, medic, battalion) and the type the schedule builder derives
 * from an apparatus ID (engine, truck, medic, bc). A type absent from here has
 * no seat composition and is judged on headcount alone.
 */
export const SEATS_BY_TYPE: Record<string, readonly Seat[]> = {
  engine:    [CAPTAIN, OPERATOR, FIREFIGHTER],
  ladder:    [CAPTAIN, OPERATOR, FIREFIGHTER],
  truck:     [CAPTAIN, OPERATOR, FIREFIGHTER],
  medic:     [PARAMEDIC, EMT],
  battalion: [BATTALION_CHIEF],
  bc:        [BATTALION_CHIEF],
}

export function seatsForType(apparatusType: string | null | undefined): readonly Seat[] | null {
  if (!apparatusType) return null
  return SEATS_BY_TYPE[apparatusType.toLowerCase()] ?? null
}

// ── Assessment ────────────────────────────────────────────────────────────────

export interface CrewMemberForStaffing {
  rank: string | null | undefined
  assignmentType: string
  /** employees.is_paramedic — decides whether a captain may hold a medic seat. */
  isParamedic?: boolean | null
  /** When this member comes on and off. Null means the whole shift. */
  startDt?: string | null
  endDt?: string | null
}

/**
 * Is this member aboard at the given instant?
 *
 * A member with no recorded window is treated as covering the whole shift,
 * which is what a row written before start_dt and end_dt were populated looks
 * like — better to count them than to empty a unit on missing data.
 */
function isAboardAt(member: CrewMemberForStaffing, at: number): boolean {
  if (!member.startDt || !member.endDt) return true
  const start = Date.parse(member.startDt)
  const end   = Date.parse(member.endDt)
  if (Number.isNaN(start) || Number.isNaN(end)) return true
  return at >= start && at < end
}

export interface StaffingAssessment {
  /** Bodies that count toward staffing — excludes leave, light duty, interns. */
  staffingCount: number
  /** Seats this unit requires, empty when it has no defined composition. */
  requiredSeats: readonly Seat[]
  /** Labels of required seats nobody aboard can fill, e.g. ['CPT']. */
  openSeats: string[]
  /** True when a seat is unfilled, or when the plain headcount is under. */
  isShort: boolean
}

/**
 * Match crew to seats and report what is missing.
 *
 * Uses maximum bipartite matching rather than filling seats in order. Assigning
 * greedily can strand a seat that only one person could have filled: given a
 * captain and a firefighter for CPT/AO/FF seats, taking the captain for the
 * firefighter seat first would report the captain's seat open. Crews are small
 * enough that exact matching costs nothing.
 *
 * `at` makes the answer a point in time rather than a headcount. Two members
 * covering one seat in relief — 0800-1800 and 1800-0600 — are two bodies over
 * the day but one seat at any moment, and counting both reported Engine 1 as
 * 4/3 when it was properly staffed with a relief. Pass the instant the board is
 * describing; omit it to count everyone assigned, which is the right answer
 * when planning a day rather than looking at one.
 */
export function assessStaffing(
  apparatusType: string | null | undefined,
  crew: readonly CrewMemberForStaffing[],
  minStaffing: number,
  at?: number | null,
): StaffingAssessment {
  const present = at == null ? crew : crew.filter((c) => isAboardAt(c, at))
  const counting = present.filter((c) => countsForStaffing(c.assignmentType))
  const staffingCount = counting.length
  const seats = seatsForType(apparatusType)

  if (!seats) {
    return {
      staffingCount,
      requiredSeats: [],
      openSeats: [],
      isShort: staffingCount < minStaffing,
    }
  }

  // seatOwner[i] = index into `counting` of whoever holds seat i, or -1.
  const seatOwner: number[] = seats.map(() => -1)

  const canFill = (person: number, seat: number) => {
    const member = counting[person]
    if (member.rank == null || !seats[seat].ranks.includes(member.rank)) return false
    if (seats[seat].requiresParamedic && !isParamedicQualified(member)) return false
    return true
  }

  // Augmenting path: try to seat `person`, displacing others where they have an
  // alternative seat available.
  const seatPerson = (person: number, tried: boolean[]): boolean => {
    for (let seat = 0; seat < seats.length; seat++) {
      if (tried[seat] || !canFill(person, seat)) continue
      tried[seat] = true
      if (seatOwner[seat] === -1 || seatPerson(seatOwner[seat], tried)) {
        seatOwner[seat] = person
        return true
      }
    }
    return false
  }

  for (let person = 0; person < counting.length; person++) {
    seatPerson(person, seats.map(() => false))
  }

  const openSeats = seats
    .map((seat, i) => (seatOwner[i] === -1 ? seat.label : null))
    .filter((label): label is string => label !== null)

  return {
    staffingCount,
    requiredSeats: seats,
    openSeats,
    isShort: openSeats.length > 0 || staffingCount < minStaffing,
  }
}
