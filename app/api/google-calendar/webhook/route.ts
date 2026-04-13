import { type NextRequest, NextResponse } from "next/server"
import { syncGoogleCalendar } from "@/lib/google-calendar"

/**
 * Receives Google Calendar push notifications.
 * Google sends a POST with X-Goog-Resource-State = "sync" (initial handshake)
 * or "exists" (resource changed). We always return 200 quickly, then sync.
 *
 * To register this webhook with Google, call the Calendar API's watch endpoint:
 *   POST https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/watch
 *   { "id": "<unique-channel-id>", "type": "web_hook", "address": "<your-url>/api/google-calendar/webhook" }
 *
 * Note: Google requires HTTPS, so this only works on Vercel (not localhost).
 * Webhooks expire after ~1 week and must be renewed.
 */
export async function POST(request: NextRequest) {
  const state = request.headers.get("x-goog-resource-state")

  // Always acknowledge immediately so Google doesn't retry
  if (state === "sync" || state === "exists") {
    // Fire-and-forget — don't await so the 200 response is sent instantly
    syncGoogleCalendar().catch((err) =>
      console.error("[google-calendar/webhook] sync failed:", err),
    )
  }

  return new NextResponse(null, { status: 200 })
}
