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
const PARAMEDIC: Seat = { label: 'PM',  ranks: ['SRP'] }
const EMT: Seat       = { label: 'EMT', ranks: ['SRE'] }
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
 */
export function assessStaffing(
  apparatusType: string | null | undefined,
  crew: readonly CrewMemberForStaffing[],
  minStaffing: number,
): StaffingAssessment {
  const counting = crew.filter((c) => countsForStaffing(c.assignmentType))
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
    const rank = counting[person].rank
    return rank != null && seats[seat].ranks.includes(rank)
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
