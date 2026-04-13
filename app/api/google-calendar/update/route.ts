import { type NextRequest, NextResponse } from "next/server"
import { updateGoogleCalendarEvent, type EventPatch } from "@/lib/google-calendar"

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as EventPatch
    if (!body.google_event_id) {
      return NextResponse.json({ error: "google_event_id is required" }, { status: 400 })
    }
    await updateGoogleCalendarEvent(body)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("[google-calendar/update]", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
