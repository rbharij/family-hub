import { NextResponse } from "next/server"
import { swapMeal, getServerSupabase } from "@/lib/meal-planner-server"
import type { SlotKey } from "@/lib/meal-planner"

export const maxDuration = 60
export const dynamic = "force-dynamic"

const SLOTS: SlotKey[] = ["dinner", "lunch", "lunchbox", "car_dinner"]

export async function POST(req: Request) {
  try {
    const body = await req.json() as { weekStart?: string; date?: string; slot?: SlotKey; hint?: string }
    if (!body.weekStart || !body.date || !body.slot || !SLOTS.includes(body.slot)) {
      return NextResponse.json({ error: "weekStart, date and slot are required" }, { status: 400 })
    }
    const plan = await swapMeal(getServerSupabase(), body.weekStart, body.date, body.slot, body.hint?.slice(0, 200))
    return NextResponse.json({ plan })
  } catch (err) {
    console.error("[meal-plan/swap]", err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Swap failed" }, { status: 500 })
  }
}
