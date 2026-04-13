import { NextResponse } from "next/server"
import { syncGoogleCalendar } from "@/lib/google-calendar"

export async function GET() {
  try {
    const result = await syncGoogleCalendar()
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("[google-calendar/sync]", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
