import { NextResponse } from "next/server"
import { getMealRecipe, getServerSupabase } from "@/lib/meal-planner-server"

export const maxDuration = 60
export const dynamic = "force-dynamic"

/** Recipe for a meal on the Meals page (stored after the first time). */
export async function POST(req: Request) {
  try {
    const body = await req.json() as { mealId?: string; refresh?: boolean }
    if (!body.mealId) return NextResponse.json({ error: "mealId is required" }, { status: 400 })
    const recipe = await getMealRecipe(getServerSupabase(), body.mealId, Boolean(body.refresh))
    return NextResponse.json({ recipe })
  } catch (err) {
    console.error("[meals/recipe]", err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't load the recipe" }, { status: 500 })
  }
}
