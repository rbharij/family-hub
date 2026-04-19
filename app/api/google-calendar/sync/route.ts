import { NextResponse } from "next/server"
import { syncGoogleCalendar } from "@/lib/google-calendar"

export async function GET() {
  try {
    const result = await syncGoogleCalendar()
    return NextResponse.json(result)
  } catch (err) {
    // Log the full error object so the real Google API error is visible in server logs
    console.error("[google-calendar/sync] full error:", err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
