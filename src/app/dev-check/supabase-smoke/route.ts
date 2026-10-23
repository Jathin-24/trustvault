import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'

// TEMPORARY smoke-test route — delete after verifying Supabase keys work.
export async function GET() {
  const supabase = await createClient()

  const { data, error } = await supabase.auth.getUser()

  return NextResponse.json({
    reachable: !error || error.status !== 0,
    user: data.user?.id ?? null,
    error: error?.message ?? null,
    status: error?.status ?? 200,
  })
}
