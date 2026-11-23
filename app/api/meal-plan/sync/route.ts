import { NextResponse } from "next/server"
import { syncAfterDinnerChange, getServerSupabase } from "@/lib/meal-planner-server"

export const maxDuration = 60
export const dynamic = "force-dynamic"

/** Rewrites the lunchbox / car dinner made from a dinner after it was changed by hand. */
export async function POST(req: Request) {
  try {
    const body = await req.json() as { weekStart?: string; date?: string }
    if (!body.weekStart || !body.date) {
      return NextResponse.json({ error: "weekStart and date are required" }, { status: 400 })
    }
    const { row, changed } = await syncAfterDinnerChange(getServerSupabase(), body.weekStart, body.date)
    return NextResponse.json({ plan: row, changed })
  } catch (err) {
    console.error("[meal-plan/sync]", err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't update the linked meals" }, { status: 500 })
  }
}
