import { NextResponse } from "next/server"
import { deleteGoogleCalendarEvent } from "@/lib/google-calendar"

export async function POST(req: Request) {
  try {
    const { google_event_id } = await req.json()
    if (!google_event_id) {
      return NextResponse.json({ error: "google_event_id is required" }, { status: 400 })
    }
    await deleteGoogleCalendarEvent(google_event_id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("[google-calendar/delete]", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
