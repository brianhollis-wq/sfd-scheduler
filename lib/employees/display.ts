/**
 * How a member's name is shown.
 *
 * The department calls people by a go-by name that is often not their formal
 * one — Jack Westerman is Wes, John Beaudoin is Alex, Robert Schaffer is Bob.
 * The schedule, the shift list and CrewSense all print the go-by; only the
 * personnel record holds the formal name.
 *
 * So `nickname` is what goes on screen when it is set, and the formal first
 * name is the fallback. The formal name is never overwritten: payroll, the
 * personnel master and any official record need it, and a member who joins
 * with a nickname and later drops it should not lose their real name.
 *
 * Matching is a separate concern and lives in lib/employees/find.ts — a name
 * arriving from a schedule has to resolve whether it is formal or go-by, which
 * is the opposite direction from display.
 */

export interface NameFields {
  first_name: string
  last_name:  string
  /** Go-by name. Null or empty means the member uses their formal first name. */
  nickname?:  string | null
}

/** The first name to show: the go-by when there is one. */
export function displayFirstName(e: NameFields): string {
  const n = e.nickname?.trim()
  return n || e.first_name
}

/** "Wes Westerman" — full name as the department says it. */
export function displayName(e: NameFields): string {
  return `${displayFirstName(e)} ${e.last_name}`.trim()
}

/**
 * The crew board's form: "Westerman, Wes" where there is a go-by name,
 * "Grimmer, A." where there is not.
 *
 * Abbreviating a nickname defeats the point of having one. "Westerman, W."
 * tells a reader no more than "Westerman, J." did — the whole reason the
 * nickname is stored is that Wes is what people call him and what they will
 * recognise on a board. A formal first name is abbreviated as before, since
 * nobody is looking for it.
 */
export function displayShortName(e: NameFields): string {
  const nick = e.nickname?.trim()
  return nick ? `${e.last_name}, ${nick}` : `${e.last_name}, ${e.first_name.charAt(0)}.`
}

/** "Westerman, Wes" — used where there is room for the whole go-by name. */
export function displayListName(e: NameFields): string {
  return `${e.last_name}, ${displayFirstName(e)}`
}
