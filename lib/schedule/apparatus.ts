/**
 * Apparatus classification shared by the crew board and the schedule builder.
 *
 * ADMIN_UNITS lived only in the crew board, but the department-wide daily
 * minimum is computed on both boards and both must exclude the same units —
 * otherwise the two screens report a different "On Duty" number for the
 * same day.
 */

/**
 * Administration and specialty assignments.
 *
 * Nobody assigned to one of these counts toward minimum staffing. They are
 * real people at work — they appear on the board, they hold their assignment,
 * and they are not available for overtime — but none of them fills a line
 * seat, so neither an apparatus minimum nor the department's daily minimum
 * may count them.
 *
 *   DFM-*   deputy fire marshals
 *   EMS-*   EMS division (deputy chief, coordinator, training)
 *   TR-*    training division (deputy chief, captains, apparatus operator)
 *   LD      light duty
 */
export const ADMIN_UNITS = new Set<string>([
  'DFM-1', 'DFM-2', 'DFM-3', 'DFM-4', 'DFM-5',
  'EMS-DC', 'EMS-COORD', 'EMS-TRN',
  'TR-DC', 'TR-CPT1', 'TR-CPT2', 'TR-AO',
  'LD',
])

/** Is this an administration or specialty assignment rather than a line unit? */
export function isAdminApparatus(apparatusId: string | null | undefined): boolean {
  return apparatusId != null && ADMIN_UNITS.has(apparatusId)
}

/**
 * Does an assignment on this apparatus count toward the department's daily
 * minimum staffing number?
 *
 * Pair this with countsForStaffing() from ./assignment-types — the two answer
 * different halves of the same question. A member is counted only when BOTH
 * their assignment type fills a seat (not leave, not light duty) AND the unit
 * they are on is a line unit (not administration or specialty).
 */
export function apparatusCountsTowardMinimum(apparatusId: string | null | undefined): boolean {
  return !isAdminApparatus(apparatusId)
}
