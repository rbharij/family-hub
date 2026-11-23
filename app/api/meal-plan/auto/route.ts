import { NextResponse } from "next/server"
import { generatePlan, getServerSupabase, mondayOf, todayLocal } from "@/lib/meal-planner-server"
import { addDaysStr } from "@/lib/meal-planner"
import { syncGoogleCalendar } from "@/lib/google-calendar"

export const maxDuration = 120
export const dynamic = "force-dynamic"

/**
 * Weekly auto-draft, called by Vercel Cron (see vercel.json).
 * Drafts next week's plan if auto-draft is on and no plan exists yet.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
  }

  try {
    const supabase  = getServerSupabase()
    const weekStart = addDaysStr(mondayOf(todayLocal()), 7)

    const { data: settings } = await supabase.from("meal_planner_settings").select("auto_draft").limit(1).maybeSingle()
    if (!(settings as { auto_draft?: boolean } | null)?.auto_draft) {
      return NextResponse.json({ skipped: "auto-draft is off" })
    }

    const { data: existing } = await supabase.from("meal_plans").select("id").eq("week_start", weekStart).maybeSingle()
    if (existing) return NextResponse.json({ skipped: "plan already exists", weekStart })

    await syncGoogleCalendar().catch(() => null)
    const plan = await generatePlan(supabase, weekStart, { source: "auto", keepLocked: true })
    return NextResponse.json({ drafted: plan.week_start })
  } catch (err) {
    console.error("[meal-plan/auto]", err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Auto-draft failed" }, { status: 500 })
  }
}
