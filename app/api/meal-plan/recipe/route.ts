import { NextResponse } from "next/server"
import { getRecipe, getServerSupabase } from "@/lib/meal-planner-server"
import type { SlotKey } from "@/lib/meal-planner"

export const maxDuration = 60
export const dynamic = "force-dynamic"

const SLOTS: SlotKey[] = ["dinner", "lunch", "lunchbox", "car_dinner"]

export async function POST(req: Request) {
  try {
    const body = await req.json() as { weekStart?: string; date?: string; slot?: SlotKey; refresh?: boolean }
    if (!body.weekStart || !body.date || !body.slot || !SLOTS.includes(body.slot)) {
      return NextResponse.json({ error: "weekStart, date and slot are required" }, { status: 400 })
    }
    const recipe = await getRecipe(getServerSupabase(), body.weekStart, body.date, body.slot, Boolean(body.refresh))
    return NextResponse.json({ recipe })
  } catch (err) {
    console.error("[meal-plan/recipe]", err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Recipe failed" }, { status: 500 })
  }
}
