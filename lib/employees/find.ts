/**
 * Employee lookup by name.
 *
 * Extracted from the PDF import route so the permanent roster
 * (lib/schedule/admin-roster.ts) resolves people the same way the PDF importer
 * does. Two matchers would drift, and a name that resolves on one path but not
 * the other silently drops someone off the board.
 *
 * employees.id is an integer; the original copy of this code declared it as
 * string and cast around it.
 */

import { TABLES } from '@/lib/db/tables'
import type { createAdminClient } from '@/lib/supabase/admin'

export type AdminClient = ReturnType<typeof createAdminClient>

// ── Nickname / alternate-name lookup ─────────────────────────────
//
// Maps common PDF nicknames → possible formal DB names.
// Add entries here as new cases are found.

export const NICKNAME_MAP: Record<string, string[]> = {
  TJ:    ['Timothy', 'Thomas'],
  Jeff:  ['Jeffrey'],
  Bill:  ['William'],
  Bob:   ['Robert'],
  Mike:  ['Michael'],
  Jim:   ['James'],
  Tom:   ['Thomas'],
  Dave:  ['David'],
  Dan:   ['Daniel'],
  Chris: ['Christopher'],
  Matt:  ['Matthew'],
  Nick:  ['Nicholas'],
  Pat:   ['Patrick'],
  Rick:  ['Richard'],
  Joe:   ['Joseph'],
  Joey:  ['Joseph'],   // Joey Weigand → Joseph Weigand
  Steve: ['Steven', 'Stephen'],
  Tony:  ['Anthony'],
  Pete:  ['Peter'],
  Alex:  ['Alexander', 'John'],   // Alex Beaudoin → John Beaudoin
  Andy:  ['Andrew'],
  Bud:   ['Robert'],
  Liz:   ['Elizabeth'],
  Kate:  ['Katherine', 'Kathleen'],
  Kathy: ['Katherine', 'Kathleen'],
  Zach:  ['Zachary', 'Zachery'],   // Zach Hanna → Zachary Hanna
  Zack:  ['Zachary', 'Zachery'],
  Nate:  ['Nathaniel', 'Nathan'],
  Ben:   ['Benjamin'],
  Sam:   ['Samuel'],
  Tim:   ['Timothy'],
  Jen:   ['Jennifer'],
  Jenn:  ['Jennifer'],
  Lenny: ['Leonard'],
  Denny: ['Dennis', 'Denzel'],
  Josh:  ['Joshua'],
  Jonah: ['Jonathan'],
  Jon:   ['Jonathan'],
  Abe:   ['Abraham'],
  Gabe:  ['Gabriel'],
  // Go-by names that are not short forms of the formal name. The last name
  // still has to match, so listing the ordinary expansion first keeps the
  // common case ahead of the department-specific one: Wes Strawn resolves to
  // Wesley Strawn, Wes Westerman to Jack Westerman.
  Wes:   ['Wesley', 'Jack'],      // Wes Westerman → Jack Westerman
  JJ:    ['Gerardo'],             // JJ Oliveros → Gerardo Oliveros
}

export interface EmployeeRow {
  id: number
  first_name: string
  last_name: string
}

export async function findEmployee(
  supabase: AdminClient,
  firstName: string,
  lastName: string,
): Promise<EmployeeRow | null> {
  // 1. Exact ilike match
  const { data: exact } = await supabase
    .from(TABLES.employees)
    .select('id, first_name, last_name')
    .ilike('first_name', firstName)
    .ilike('last_name', lastName)
    .limit(1)
    .maybeSingle()
  if (exact) return exact as EmployeeRow

  // 2. Nickname expansion (Zach → Zachary, Jeff → Jeffrey, etc.)
  const altFirstNames = NICKNAME_MAP[firstName] ?? []
  for (const alt of altFirstNames) {
    const { data } = await supabase
      .from(TABLES.employees)
      .select('id, first_name, last_name')
      .ilike('first_name', alt)
      .ilike('last_name', lastName)
      .limit(1)
      .maybeSingle()
    if (data) return data as EmployeeRow
  }

  // 3. Hyphen normalization: Sanchez-Lopez → Sanchez Lopez
  if (lastName.includes('-')) {
    const normalized = lastName.replace(/-/g, ' ')
    const { data } = await supabase
      .from(TABLES.employees)
      .select('id, first_name, last_name')
      .ilike('first_name', firstName)
      .ilike('last_name', normalized)
      .limit(1)
      .maybeSingle()
    if (data) return data as EmployeeRow

    // 4. Nickname + hyphen normalization combined
    for (const alt of altFirstNames) {
      const { data: d2 } = await supabase
        .from(TABLES.employees)
        .select('id, first_name, last_name')
        .ilike('first_name', alt)
        .ilike('last_name', normalized)
        .limit(1)
        .maybeSingle()
      if (d2) return d2 as EmployeeRow
    }
  }

  // 5. name_aliases table — catches edge cases like "Alex Beaudoin" → John Beaudoin,
  //    "David Olvera" → David Olvera-Godinez, CCC interns, etc.
  //    Schema: name_aliases(alias text PK, employee_id int FK employees.id)
  const alias = `${firstName} ${lastName}`.trim()
  const { data: aliasRow } = await supabase
    .from(TABLES.nameAliases)
    .select('employee_id')
    .ilike('alias', alias)
    .limit(1)
    .maybeSingle()

  if (aliasRow) {
    const { data: emp } = await supabase
      .from(TABLES.employees)
      .select('id, first_name, last_name')
      .eq('id', (aliasRow as { employee_id: number }).employee_id)
      .limit(1)
      .maybeSingle()
    if (emp) return emp as EmployeeRow
  }

  return null
}

