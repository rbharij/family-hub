import { NextResponse } from "next/server"
import { applySavedRecipe, getServerSupabase } from "@/lib/meal-planner-server"
import type { SlotKey } from "@/lib/meal-planner"

export const maxDuration = 90
export const dynamic = "force-dynamic"

const SLOTS: SlotKey[] = ["dinner", "lunch", "lunchbox", "car_dinner"]

/** Use one of the family's saved recipes for a meal in the plan. */
export async function POST(req: Request) {
  try {
    const body = await req.json() as { weekStart?: string; date?: string; slot?: SlotKey; recipeId?: string }
    if (!body.weekStart || !body.date || !body.slot || !SLOTS.includes(body.slot) || !body.recipeId) {
      return NextResponse.json({ error: "weekStart, date, slot and recipeId are required" }, { status: 400 })
    }
    const { row, changed } = await applySavedRecipe(getServerSupabase(), body.weekStart, body.date, body.slot, body.recipeId)
    return NextResponse.json({ plan: row, changed })
  } catch (err) {
    console.error("[meal-plan/use-recipe]", err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't use that recipe" }, { status: 500 })
  }
}
