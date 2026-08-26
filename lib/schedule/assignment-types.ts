/**
 * Canonical assignment-type vocabulary for daily_assignments.assignment_type.
 *
 * This module is the SINGLE SOURCE OF TRUTH. Before it existed, four files
 * each kept their own `ON_DUTY_TYPES` set and they had drifted apart —
 * most importantly `light_duty`, which the crew board counted as on duty
 * while the MOT and callback eligibility APIs did not. That meant a member
 * on light duty showed up staffed on the board and simultaneously appeared
 * available for mandatory overtime.
 *
 * Do not re-declare these sets locally. Import them.
 */

// ── The vocabulary ────────────────────────────────────────────────────────────

/**
 * Types written when a member is working the shift.
 *
 * The codes below the first six came from a CrewSense report export, which
 * carries 26 distinct type codes against the 17 this file used to model —
 * 105 of 646 rows in one week could not be represented at all.
 *
 * `overtime` and `callback_voluntary` are deliberately separate. The export
 * distinguishes "Overtime [OT]" from "Overtime [OT] (CallBack Shift)", and
 * the data shows what the difference is: every callback row is a full 24-hour
 * vacancy on a line apparatus filled by somebody on a day off, while plain
 * overtime is partial coverage — 2, 4, 10 and 13.5-hour rows, mostly on medic
 * units and the peak medics. That is the same line recordCallbackAction draws
 * when it moves a member to the bottom of the list for a full shift but only
 * stamps the date for a partial one, so flattening the two would lose a
 * distinction the overtime lists already depend on.
 */
export const ON_DUTY_ASSIGNMENT_TYPES = [
  'regular',
  'callback_voluntary',
  'callback_mandatory',
  'peak_engine',
  'trade',
  'light_duty',
  'overtime',        // Overtime [OT] — partial coverage, medic and peak units
  'double_time',     // Double Time [DT]
  'debit_relief',    // Debit Day Relief, and DEBIT DAY BC RELIEF
  'on_call_dfm',     // On Call DFM [OnCall]
  'qi_committee',    // QI Committee [QI] — at work, off the apparatus
  'training',        // Training [TRNG] — at work, off the apparatus
] as const

/**
 * Types written when a member is scheduled but absent.
 * This is the exact set the crew board, the MOT and callback eligibility APIs,
 * and the schedule builder's "mark absent" menu each carried their own copy of.
 */
export const LEAVE_ASSIGNMENT_TYPES = [
  'vacation',
  'sick',
  'FMLA',
  'OFLA',
  'PLO',
  'injury',
  'kelly_day',
  'WOC',
  'AIC',
  'BUM',
  // From the CrewSense export. PFML is kept separate from FMLA and OFLA
  // rather than folded into either, because the three are separate
  // entitlements and are accrued and reported separately.
  'PFML',            // Paid Family & Medical Leave
  'LTD',             // Long Term Disability
  'STL',             // Short Term Leave
  'PTO_vacation',    // PTO - Vacation, distinct from the vacation bank
  'PTO_sick',        // PTO - Sick Leave
  'bereavement',
  'union_leave',
  'jury_duty',
] as const

/** Non-department personnel tracked for accountability, never for staffing. */
export const INTERN_ASSIGNMENT_TYPES = ['ccc_intern'] as const

export type OnDutyAssignmentType = (typeof ON_DUTY_ASSIGNMENT_TYPES)[number]
export type LeaveAssignmentType  = (typeof LEAVE_ASSIGNMENT_TYPES)[number]
export type InternAssignmentType = (typeof INTERN_ASSIGNMENT_TYPES)[number]

export type AssignmentType =
  | OnDutyAssignmentType
  | LeaveAssignmentType
  | InternAssignmentType

// ── Sets (for hot-path lookups) ───────────────────────────────────────────────

export const ON_DUTY_TYPES = new Set<string>(ON_DUTY_ASSIGNMENT_TYPES)
export const LEAVE_TYPES   = new Set<string>(LEAVE_ASSIGNMENT_TYPES)
export const INTERN_TYPES  = new Set<string>(INTERN_ASSIGNMENT_TYPES)

/**
 * On-duty types that are paid as overtime. Kept in sync with the PDF parser's
 * OT type codes (O = voluntary callback, M = mandatory callback).
 */
export const OT_TYPES = new Set<string>([
  'callback_voluntary',
  'callback_mandatory',
  'peak_engine',
  'overtime',
  'double_time',
])

/**
 * On-duty types that do NOT fill a line seat.
 *
 * A member on light duty is at work — so they are on duty and unavailable for
 * overtime — but they are medically restricted off apparatus and do NOT count
 * toward an apparatus minimum-staffing number, or toward the department-wide
 * daily minimum.
 *
 * This is the reason isOnDuty() and countsForStaffing() are separate
 * predicates. Roster displays list these members (they are present and
 * accounted for); anything compared against a staffing minimum must not.
 */
export const NON_STAFFING_ON_DUTY_TYPES = new Set<string>([
  'light_duty',
  // At work and unavailable for overtime, but not on an apparatus, so they
  // fill no seat — the same reason light duty is here.
  'qi_committee',
  'training',
])

// ── Predicates ────────────────────────────────────────────────────────────────

/** Is this member working the shift? Drives overtime availability. */
export function isOnDuty(assignmentType: string | null | undefined): boolean {
  return assignmentType != null && ON_DUTY_TYPES.has(assignmentType)
}

/** Is this member scheduled but absent (any leave code)? */
export function isLeave(assignmentType: string | null | undefined): boolean {
  return assignmentType != null && LEAVE_TYPES.has(assignmentType)
}

/** Non-department personnel — shown for accountability, excluded from staffing. */
export function isIntern(assignmentType: string | null | undefined): boolean {
  return assignmentType != null && INTERN_TYPES.has(assignmentType)
}

/**
 * Does this row fill a seat toward a minimum-staffing count?
 *
 * Use this — never isOnDuty — for any number compared against min_staffing or
 * the department's daily minimum. Light-duty members are on duty but do not
 * fill a seat, so the two predicates disagree for them by design.
 */
export function countsForStaffing(assignmentType: string | null | undefined): boolean {
  return isOnDuty(assignmentType) && !NON_STAFFING_ON_DUTY_TYPES.has(assignmentType!)
}

/** Is this assignment paid as overtime? */
export function isOvertime(assignmentType: string | null | undefined): boolean {
  return assignmentType != null && OT_TYPES.has(assignmentType)
}

// ── Display ───────────────────────────────────────────────────────────────────

export const ASSIGNMENT_LABELS: Record<string, string> = {
  regular:            'Regular',
  callback_voluntary: 'Callback VOL',
  callback_mandatory: 'Callback MAN',
  peak_engine:        'Peak Engine',
  trade:              'Trade',
  light_duty:         'Light Duty',
  ccc_intern:         'CCC Intern',
  vacation:           'Vacation',
  sick:               'Sick Leave',
  FMLA:               'FMLA',
  OFLA:               'OFLA',
  PLO:                'PLO',
  injury:             'Injury Leave',
  kelly_day:          'Kelly Day',
  WOC:                'WOC',
  AIC:                'AIC',
  BUM:                'BUM',
  overtime:           'Overtime',
  double_time:        'Double Time',
  debit_relief:       'Debit Relief',
  on_call_dfm:        'On-Call DFM',
  qi_committee:       'QI Committee',
  training:           'Training',
  PFML:               'PFML',
  LTD:                'Long Term Disability',
  STL:                'Short Term Leave',
  PTO_vacation:       'PTO Vacation',
  PTO_sick:           'PTO Sick',
  bereavement:        'Bereavement',
  union_leave:        'Union Leave',
  jury_duty:          'Jury Duty',
}

export function assignmentLabel(assignmentType: string): string {
  return ASSIGNMENT_LABELS[assignmentType] ?? assignmentType
}

/**
 * Label for a leave type, or undefined if the type is not leave.
 *
 * The MOT and callback eligibility APIs branch on exactly this: a defined
 * result means the member is excluded from overtime with that reason shown,
 * undefined means keep evaluating. Do not widen it to cover on-duty types.
 */
export function leaveExclusionLabel(assignmentType: string | null | undefined): string | undefined {
  return isLeave(assignmentType) ? ASSIGNMENT_LABELS[assignmentType!] : undefined
}

/** Options offered by the "mark absent" menu in the schedule builder. */
export const LEAVE_TYPE_OPTIONS = LEAVE_ASSIGNMENT_TYPES.map((value) => ({
  value,
  label: assignmentLabel(value),
}))

/**
 * Options offered when assigning or swapping a member in the schedule builder.
 *
 * ccc_intern is here so a student can be swapped for another — they trade days
 * between themselves — and so one can be added to a unit directly. It is not an
 * on-duty type and fills no seat; it is assignable, which is a different thing.
 */
export const ASSIGNABLE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  'callback_voluntary',
  'callback_mandatory',
  'overtime',
  'peak_engine',
  'trade',
  'debit_relief',
  'regular',
  'ccc_intern',
].map((value) => ({ value, label: assignmentLabel(value) }))
