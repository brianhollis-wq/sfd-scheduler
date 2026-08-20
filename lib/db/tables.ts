/**
 * Supabase table names.
 *
 * Centralized because the codebase carried a real typo: most call sites query
 * `apparatus` (singular — the table that actually exists, used by the crew
 * board and the PDF importer) while /api/roster queried `apparatuses`, which
 * silently returned an error and left every unit falling back to default
 * metadata. Import from here so a name can only be wrong in one place.
 */

export const TABLES = {
  apparatus:         'apparatus',
  dailyAssignments:  'daily_assignments',
  debitDays:         'debit_days',
  employees:         'employees',
  nameAliases:       'name_aliases',
  otListPositions:   'ot_list_positions',
  shiftCalendar:     'shift_calendar',
  shiftRoster:       'shift_roster',
  shiftRotation:     'shift_rotation',
  stations:          'stations',
} as const

export type TableName = (typeof TABLES)[keyof typeof TABLES]
