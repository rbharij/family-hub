import { NextResponse } from "next/server"
import { generatePlan, getServerSupabase } from "@/lib/meal-planner-server"
import { syncGoogleCalendar } from "@/lib/google-calendar"

export const maxDuration = 120
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = await req.json() as { weekStart?: string; keepLocked?: boolean; instructions?: string }
    if (!body.weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(body.weekStart)) {
      return NextResponse.json({ error: "weekStart (YYYY-MM-DD) is required" }, { status: 400 })
    }
    // Fresh calendar data first; carry on with what is stored if Google is unavailable
    await syncGoogleCalendar().catch(() => null)

    const plan = await generatePlan(getServerSupabase(), body.weekStart, {
      source: "manual",
      keepLocked: body.keepLocked ?? true,
      instructions: body.instructions?.slice(0, 500),
    })
    return NextResponse.json({ plan })
  } catch (err) {
    console.error("[meal-plan/generate]", err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Plan generation failed" }, { status: 500 })
  }
}
