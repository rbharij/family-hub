import { NextResponse } from "next/server"
import { createGoogleCalendarEvent } from "@/lib/google-calendar"
import type { EventCreate } from "@/lib/google-calendar"

export async function POST(req: Request) {
  try {
    const body: EventCreate = await req.json()
    const googleEventId = await createGoogleCalendarEvent(body)
    return NextResponse.json({ google_event_id: googleEventId })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("[google-calendar/create]", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
