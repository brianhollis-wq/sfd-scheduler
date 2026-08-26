/**
 * GET /api/employees/search?q=smith&limit=20
 *
 * Full-text employee search used by the assignment builder swap modal.
 * Searches first_name and last_name via ilike.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { TABLES } from '@/lib/db/tables'
import { withUser } from '@/lib/auth/guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withUser<NextRequest>(async (request) => {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim() ?? ''
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 50)

  if (q.length < 2) {
    return NextResponse.json({ employees: [] })
  }

  const supabase = createAdminClient()

  // Try last name first (most common search pattern), then fallback to OR across both fields
  const pattern = `%${q}%`

  const { data, error } = await supabase
    .from(TABLES.employees)
    .select('id, first_name, last_name, rank, badge_number, is_paramedic, shift_assignment')
    .or(`last_name.ilike.${pattern},first_name.ilike.${pattern}`)
    .order('last_name')
    .order('first_name')
    .limit(limit)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ employees: data ?? [] })
})
