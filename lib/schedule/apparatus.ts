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
  // Community Risk Reduction — six deputy fire marshals (FM1–FM6)
  'DFM-1', 'DFM-2', 'DFM-3', 'DFM-4', 'DFM-5', 'DFM-6',
  // Fire prevention inspectors
  'INSP-1', 'INSP-2',
  // EMS division
  'EMS-DC', 'EMS-COORD', 'EMS-TRN', 'EMS-PDA1', 'EMS-PDA2', 'EMS-BILL', 'EMS-SA',
  // Training division
  'TR-DC', 'TR-CPT1', 'TR-CPT2', 'TR-AO', 'TR-SA',
  // Administration — Office of the Fire Chief, Emergency Operations,
  // Business Operations, Emergency Management
  'C-1', 'C-2', 'C-3', 'C-4', 'DC-OPS', 'EM-1',
  'FCO-1', 'FCO-2', 'BOD-1', 'BOD-2',
  // Light duty
  'LD',
])

// ── Board layout below the battalions ────────────────────────────────────────

/**
 * A unit on temporary assignment, shown out of its normal place under the
 * heading it is currently working.
 *
 * BR-5 lives at Station 5 as an in-service-unstaffed brush unit, like BR-1 and
 * BR-7. When it is crewed for a conflagration it moves into the Specialty
 * section under that heading, and it returns to Station 5 by itself as soon as
 * the crew comes off — the board reads the assignment from whether the unit has
 * anyone on it, so nothing has to be switched off by hand when the deployment
 * ends.
 */
export const TEMPORARY_ASSIGNMENTS: Record<string, string> = {
  'BR-5': 'CONFLAGRATION',
}

export function temporaryAssignmentLabel(apparatusId: string): string | null {
  return TEMPORARY_ASSIGNMENTS[apparatusId] ?? null
}

/**
 * Is this unit currently deployed on its temporary assignment?
 *
 * True only while it is actually crewed. An empty unit belongs back in its
 * station list.
 */
export function isOnTemporaryAssignment(apparatusId: string, onDutyCrewCount: number): boolean {
  return temporaryAssignmentLabel(apparatusId) != null && onDutyCrewCount > 0
}

export interface BoardGroup {
  /** Sub-heading inside a section, e.g. a division within Administration. */
  title: string
  unitIds: readonly string[]
}

export interface BoardSection {
  title: string
  /**
   * Units in display order. Absent or empty ones are simply not rendered.
   * A section carries either a flat unit list or divisions, never both.
   */
  unitIds?: readonly string[]
  /** Divisions rendered as sub-headings, in order. */
  groups?: readonly BoardGroup[]
}

/**
 * Sections rendered beneath the battalions, in order.
 *
 * Nobody in any of them counts toward minimum staffing — that is enforced by
 * MIN_STAFFING_UNITS above, which lists the active apparatus and nothing here.
 */
export const BOARD_SECTIONS: readonly BoardSection[] = [
  // BR-5 appears here only while it is crewed for a conflagration.
  { title: 'Specialty',               unitIds: ['LD', 'BR-5'] },
  { title: 'Community Risk Reduction', unitIds: ['DFM-1', 'DFM-2', 'DFM-3', 'DFM-4', 'DFM-5', 'DFM-6', 'INSP-1', 'INSP-2'] },
  { title: 'Training Division',        unitIds: ['TR-DC', 'TR-CPT1', 'TR-CPT2', 'TR-AO', 'TR-SA'] },
  { title: 'EMS',                      unitIds: ['EMS-DC', 'EMS-COORD', 'EMS-TRN', 'EMS-PDA1', 'EMS-PDA2', 'EMS-BILL', 'EMS-SA'] },
  {
    title: 'Administration',
    groups: [
      { title: 'Office of the Fire Chief',   unitIds: ['C-1', 'FCO-1', 'FCO-2'] },
      { title: 'Emergency Operations Division', unitIds: ['C-2', 'DC-OPS', 'C-4'] },
      { title: 'Business Operations Division',  unitIds: ['C-3', 'EM-1', 'BOD-1', 'BOD-2'] },
    ],
  },
]

/** A section's units, flattened across its divisions if it has any. */
export function sectionUnitIds(section: BoardSection): string[] {
  return section.groups
    ? section.groups.flatMap((g) => [...g.unitIds])
    : [...(section.unitIds ?? [])]
}

/** Every unit claimed by a named section. */
export const SECTIONED_UNIT_IDS = new Set<string>(
  BOARD_SECTIONS.flatMap(sectionUnitIds),
)

/** Is this an administration or specialty assignment rather than a line unit? */
export function isAdminApparatus(apparatusId: string | null | undefined): boolean {
  return apparatusId != null && ADMIN_UNITS.has(apparatusId)
}

/**
 * The active apparatus whose staffing makes up the department's daily minimum.
 *
 * This is an explicit allowlist, not a category rule: minimum staffing counts
 * only bodies on these units. Anything absent — reserve apparatus, brush and
 * water units, harbor, hazmat, administration and specialty assignments — is
 * not counted, whether or not it is staffed that day.
 *
 * ID formats follow mapApparatusName() in lib/parse-schedule.ts, which is what
 * actually writes apparatus_id: engines E-N, trucks TR-N, battalion chiefs
 * BC-N, medics M-N.
 */
export const MIN_STAFFING_UNITS = new Set<string>([
  // Engines 1–11
  'E-1', 'E-2', 'E-3', 'E-4', 'E-5', 'E-6', 'E-7', 'E-8', 'E-9', 'E-10', 'E-11',
  // Trucks 2 and 4
  'TR-2', 'TR-4',
  // Battalion chiefs 2 and 4
  'BC-2', 'BC-4',
  // Medics 1, 2, 3, 4, 5, 7, 9, 10
  'M-1', 'M-2', 'M-3', 'M-4', 'M-5', 'M-7', 'M-9', 'M-10',
])

/**
 * Does an assignment on this apparatus count toward the department's daily
 * minimum staffing number?
 *
 * Pair this with countsForStaffing() from ./assignment-types — the two answer
 * different halves of the same question. A member is counted only when BOTH
 * their assignment type fills a seat (not leave, not light duty) AND they are
 * on one of the active apparatus above.
 */
export function apparatusCountsTowardMinimum(apparatusId: string | null | undefined): boolean {
  return apparatusId != null && MIN_STAFFING_UNITS.has(apparatusId)
}

/**
 * Active apparatus that are missing from a set of loaded apparatus IDs.
 *
 * The allowlist is hand-maintained, so a renamed or retired unit would
 * silently stop contributing to the daily minimum and the number would drop
 * with no visible cause. Callers log whatever this returns.
 */
export function missingMinStaffingUnits(knownApparatusIds: Iterable<string>): string[] {
  const known = new Set(knownApparatusIds)
  const missing: string[] = []
  MIN_STAFFING_UNITS.forEach((id) => { if (!known.has(id)) missing.push(id) })
  return missing.sort()
}
