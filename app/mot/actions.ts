'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { TABLES } from '@/lib/db/tables'

// Record a mandate: moves the person to the bottom of the list and sets the date
export async function recordMandateAction(
  listPositionId: number,
  listType: string,
  fiscalYear: number,
  mandateDate: string,
) {
  const supabase = createAdminClient()

  // Fetch current record
  const { data: current, error: fetchErr } = await supabase
    .from(TABLES.otListPositions)
    .select('times_mandatoried')
    .eq('id', listPositionId)
    .single()

  if (fetchErr || !current) {
    return { error: fetchErr?.message ?? 'Entry not found' }
  }

  // Find current max rank for this list so we can append to the bottom
  const { data: maxRow, error: maxErr } = await supabase
    .from(TABLES.otListPositions)
    .select('mandatory_rank')
    .eq('list_type', listType)
    .eq('fiscal_year', fiscalYear)
    .eq('is_active', true)
    .order('mandatory_rank', { ascending: false })
    .limit(1)
    .single()

  if (maxErr) {
    return { error: maxErr.message }
  }

  const newRank  = (maxRow?.mandatory_rank ?? 0) + 1
  const newTimes = (current.times_mandatoried ?? 0) + 1

  const { error: updateErr } = await supabase
    .from(TABLES.otListPositions)
    .update({
      mandatory_rank:     newRank,
      last_mandatory_date: mandateDate,
      times_mandatoried:  newTimes,
    })
    .eq('id', listPositionId)

  if (updateErr) {
    return { error: updateErr.message }
  }

  revalidatePath('/mot')
  return { success: true, newRank, newTimes }
}

// Correct the date only — does not move position
export async function setLastMandatoryDateAction(
  listPositionId: number,
  mandateDate: string,
) {
  const supabase = createAdminClient()

  const { error } = await supabase
    .from(TABLES.otListPositions)
    .update({ last_mandatory_date: mandateDate })
    .eq('id', listPositionId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/mot')
  return { success: true }
}
