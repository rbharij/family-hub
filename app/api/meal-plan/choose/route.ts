import { NextResponse } from "next/server"
import { chooseOption, getServerSupabase } from "@/lib/meal-planner-server"
import type { SlotKey } from "@/lib/meal-planner"

export const maxDuration = 90
export const dynamic = "force-dynamic"

const SLOTS: SlotKey[] = ["dinner", "lunch", "lunchbox", "car_dinner"]

export async function POST(req: Request) {
  try {
    const body = await req.json() as { weekStart?: string; date?: string; slot?: SlotKey; index?: number }
    if (!body.weekStart || !body.date || !body.slot || !SLOTS.includes(body.slot) || typeof body.index !== "number") {
      return NextResponse.json({ error: "weekStart, date, slot and index are required" }, { status: 400 })
    }
    const { row, changed } = await chooseOption(getServerSupabase(), body.weekStart, body.date, body.slot, body.index)
    return NextResponse.json({ plan: row, changed })
  } catch (err) {
    console.error("[meal-plan/choose]", err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't choose that option" }, { status: 500 })
  }
}
