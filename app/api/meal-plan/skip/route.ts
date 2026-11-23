import { NextResponse } from "next/server"
import { setSkipped, getServerSupabase } from "@/lib/meal-planner-server"
import type { SlotKey } from "@/lib/meal-planner"

export const maxDuration = 60
export const dynamic = "force-dynamic"

const SLOTS: SlotKey[] = ["dinner", "lunch", "lunchbox", "car_dinner"]

/** Clear a meal (e.g. eating out), or put it back with { skip: false }. */
export async function POST(req: Request) {
  try {
    const body = await req.json() as { weekStart?: string; date?: string; slot?: SlotKey; skip?: boolean }
    if (!body.weekStart || !body.date || !body.slot || !SLOTS.includes(body.slot)) {
      return NextResponse.json({ error: "weekStart, date and slot are required" }, { status: 400 })
    }
    const { row, changed } = await setSkipped(getServerSupabase(), body.weekStart, body.date, body.slot, body.skip ?? true)
    return NextResponse.json({ plan: row, changed })
  } catch (err) {
    console.error("[meal-plan/skip]", err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't clear that meal" }, { status: 500 })
  }
}
