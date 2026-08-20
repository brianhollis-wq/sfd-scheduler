/**
 * Employee rank labels, shared by the crew board and the schedule builder.
 *
 * Both kept their own map and they had drifted: the crew board knew
 * CCC_Intern, SRE and SRP; the builder knew Probationary_PM under a different
 * spelling and neither knew anything civilian.
 */

/** Known ranks, longest-established spellings first. */
export const RANK_LABELS: Record<string, string> = {
  BC:              'BC',
  Senior_DFM:      'SR DFM',
  DFM:             'DFM',
  Captain:         'CAPT',
  FAO:             'FAO',
  SRP:             'SRP',
  SRE:             'SRE',
  FF_PM:           'PM/FF',
  FF:              'FF',
  Probationary_PM: 'PROB/PM',
  Probationary_FF: 'PROB',
  CCC_Intern:      'INTERN',
  Staff:           'STAFF',
}

/**
 * Civilian, non-sworn personnel.
 *
 * Matched by pattern rather than by an exact value: the administration, EMS
 * support and fire-prevention staff are all carried as civilian non-sworn, and
 * the exact spelling in the employees table is not something this code should
 * depend on. Anything mentioning "civilian" or "non sworn", in any separator or
 * casing, renders as CIV.
 */
const CIVILIAN_PATTERN = /civilian|non[\s_-]?sworn/i

/**
 * Short label for a rank, sized for the narrow rank column on a crew card.
 *
 * Unknown values are humanized rather than dumped raw: an unmapped rank used to
 * render as its own uppercased identifier, so a value like
 * "Civilian_Non_Sworn" produced nineteen characters in a column built for six.
 */
export function rankLabel(rank: string | null | undefined): string {
  if (!rank) return '—'

  const known = RANK_LABELS[rank]
  if (known) return known

  if (CIVILIAN_PATTERN.test(rank)) return 'CIV'

  // Unknown: drop separators, uppercase, and keep it short enough to fit.
  const cleaned = rank.replace(/[_-]+/g, ' ').trim().toUpperCase()
  return cleaned.length <= 8 ? cleaned : cleaned.slice(0, 8)
}

/** Is this a civilian, non-sworn employee? */
export function isCivilianRank(rank: string | null | undefined): boolean {
  return rank != null && CIVILIAN_PATTERN.test(rank)
}

/**
 * Sort order for crew rows within an apparatus. Lower sorts first.
 * Civilians and anything unrecognized fall to the end.
 */
export const RANK_SORT_ORDER: Record<string, number> = {
  BC: 1, Senior_DFM: 2, DFM: 3, Captain: 4, FAO: 5,
  SRP: 6, SRE: 7, FF_PM: 8, FF: 9,
  Probationary_PM: 10, Probationary_FF: 11, Staff: 12,
}

export function rankSortValue(rank: string | null | undefined): number {
  return RANK_SORT_ORDER[rank ?? ''] ?? 99
}
