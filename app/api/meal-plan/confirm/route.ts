import { NextResponse } from "next/server"
import { confirmPlan, getServerSupabase } from "@/lib/meal-planner-server"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = await req.json() as { weekStart?: string }
    if (!body.weekStart) return NextResponse.json({ error: "weekStart is required" }, { status: 400 })
    const result = await confirmPlan(getServerSupabase(), body.weekStart)
    return NextResponse.json(result)
  } catch (err) {
    console.error("[meal-plan/confirm]", err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Confirm failed" }, { status: 500 })
  }
}
