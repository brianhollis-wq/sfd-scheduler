'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { TABLES } from '@/lib/db/tables'
import { adminGate } from '@/lib/auth/guard'

/**
 * What every action in this file returns.
 *
 * Declared explicitly rather than inferred. Without it the return type is a
 * union of the success and failure shapes, and `result.error` stops
 * type-checking on the pages that read it — which is exactly what happened when
 * the administrator gate added another early return.
 */
export interface CallbackActionResult {
  error?:          string
  success?:        boolean
  movedToBottom?:  boolean
  newRank?:        number
  newTimes?:       number
}

// Record a voluntary callback.
// If isFullShift is true (20+ hours) the person moves to the bottom of the list.
// If isFullShift is false the date is recorded but position does not change.
export async function recordCallbackAction(
  listPositionId: string,
  listType: string,
  fiscalYear: number,
  callbackDate: string,
  isFullShift: boolean,
): Promise<CallbackActionResult> {
  // Recording overtime changes a member's place on the list. Administrators only.
  const denied = await adminGate()
  if (denied) return denied

  const supabase = createAdminClient()

  if (!isFullShift) {
    // Partial shift — update date only, no position change
    const { error } = await supabase
      .from(TABLES.otListPositions)
      .update({ last_mandatory_date: callbackDate })
      .eq('id', listPositionId)

    if (error) return { error: error.message }

    revalidatePath('/callback')
    return { success: true, movedToBottom: false }
  }

  // Full shift — move to bottom of list
  const { data: current, error: fetchErr } = await supabase
    .from(TABLES.otListPositions)
    .select('times_mandatoried')
    .eq('id', listPositionId)
    .single()

  if (fetchErr || !current) {
    return { error: fetchErr?.message ?? 'Entry not found' }
  }

  // Find current max rank for this list
  const { data: maxRow, error: maxErr } = await supabase
    .from(TABLES.otListPositions)
    .select('mandatory_rank')
    .eq('list_type', listType)
    .eq('fiscal_year', fiscalYear)
    .eq('is_active', true)
    .order('mandatory_rank', { ascending: false })
    .limit(1)
    .single()

  if (maxErr) return { error: maxErr.message }

  const newRank  = (maxRow?.mandatory_rank ?? 0) + 1
  const newTimes = (current.times_mandatoried ?? 0) + 1

  const { error: updateErr } = await supabase
    .from(TABLES.otListPositions)
    .update({
      mandatory_rank:      newRank,
      last_mandatory_date: callbackDate,
      times_mandatoried:   newTimes,
    })
    .eq('id', listPositionId)

  if (updateErr) return { error: updateErr.message }

  revalidatePath('/callback')
  return { success: true, movedToBottom: true, newRank, newTimes }
}

// Correct the last callback date only — does not move position
export async function setLastCallbackDateAction(
  listPositionId: string,
  callbackDate: string,
): Promise<CallbackActionResult> {
  // Recording overtime changes a member's place on the list. Administrators only.
  const denied = await adminGate()
  if (denied) return denied

  const supabase = createAdminClient()

  const { error } = await supabase
    .from(TABLES.otListPositions)
    .update({ last_mandatory_date: callbackDate })
    .eq('id', listPositionId)

  if (error) return { error: error.message }

  revalidatePath('/callback')
  return { success: true }
}
