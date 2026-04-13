import { google, calendar_v3 } from "googleapis"
import { createClient } from "@supabase/supabase-js"

// ── Auth ──────────────────────────────────────────────────────────────────────

function getAuthClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  )
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
  return auth
}

function getCalendarClient() {
  return google.calendar({ version: "v3", auth: getAuthClient() })
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

const CALENDAR_ID = () => process.env.GOOGLE_CALENDAR_ID ?? "primary"

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Converts a Google date string to an ISO timestamp.
 * dateTime strings (contain "T") → returned as-is.
 * Date-only strings ("YYYY-MM-DD") → treated as midnight UTC.
 * All-day end dates from Google are exclusive (day after event ends),
 * so adjustEnd=true subtracts one day and uses 23:59:59 UTC.
 */
function toISO(raw: string, adjustEnd = false): string {
  if (raw.includes("T")) return raw
  const [y, m, d] = raw.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, adjustEnd ? d - 1 : d))
  const time = adjustEnd ? "T23:59:59.000Z" : "T00:00:00.000Z"
  return date.toISOString().slice(0, 10) + time
}

// ── Event mapping (Google → Supabase) ─────────────────────────────────────────

interface MappedEvent {
  title: string
  description: string | null
  location: string | null
  start_at: string
  end_at: string | null
  is_all_day: boolean
  google_event_id: string
  google_origin: boolean
}

// New events inserted from Google get this default colour (can be changed in the app)
const GOOGLE_DEFAULT_COLOR = "#534AB7"

function mapGoogleEvent(event: calendar_v3.Schema$Event): MappedEvent | null {
  if (!event.id) return null

  const isAllDay = Boolean(event.start?.date && !event.start?.dateTime)
  const startRaw = event.start?.dateTime ?? event.start?.date
  const endRaw   = event.end?.dateTime   ?? event.end?.date

  if (!startRaw) return null

  return {
    title:           event.summary ?? "Untitled",
    description:     event.description ?? null,
    location:        event.location ?? null,
    start_at:        toISO(startRaw),
    end_at:          endRaw ? toISO(endRaw, isAllDay) : null,
    is_all_day:      isAllDay,
    google_event_id: event.id,
    google_origin:   true,
  }
}

// ── Sync (Google → Supabase, with conflict resolution) ────────────────────────

export async function syncGoogleCalendar(): Promise<{ synced: number; skipped: number }> {
  const calendar = getCalendarClient()
  const supabase = getSupabase()

  const now = new Date()
  const timeMax = new Date(now)
  timeMax.setDate(timeMax.getDate() + 60)

  // Request the `updated` field from Google for conflict resolution
  const { data } = await calendar.events.list({
    calendarId:   CALENDAR_ID(),
    timeMin:      now.toISOString(),
    timeMax:      timeMax.toISOString(),
    singleEvents: true,
    orderBy:      "startTime",
    maxResults:   250,
    fields:       "items(id,summary,description,location,start,end,updated)",
  })

  const rawItems = data.items ?? []
  const googleEvents = rawItems
    .map(mapGoogleEvent)
    .filter((e): e is MappedEvent => e !== null)

  if (googleEvents.length === 0) return { synced: 0, skipped: 0 }

  // Fetch existing Supabase rows for these google_event_ids to compare timestamps
  const googleIds = googleEvents.map((e) => e.google_event_id)
  const { data: existing } = await supabase
    .from("events")
    .select("google_event_id, updated_at")
    .in("google_event_id", googleIds)

  const supabaseUpdatedMap = new Map<string, string>(
    (existing ?? []).map((r: { google_event_id: string; updated_at: string }) => [
      r.google_event_id,
      r.updated_at,
    ]),
  )

  // Build a map of Google's updated timestamps
  const googleUpdatedMap = new Map<string, string>(
    rawItems
      .filter((i): i is calendar_v3.Schema$Event & { id: string; updated: string } =>
        Boolean(i.id && i.updated),
      )
      .map((i) => [i.id, i.updated]),
  )

  // Conflict resolution: most-recently-modified version wins.
  // New events (not in Supabase) are always upserted.
  const toUpsert: MappedEvent[] = []
  let skipped = 0

  for (const ge of googleEvents) {
    const supabaseTs = supabaseUpdatedMap.get(ge.google_event_id)

    if (!supabaseTs) {
      toUpsert.push(ge)
      continue
    }

    const googleTs = googleUpdatedMap.get(ge.google_event_id)
    if (!googleTs) { skipped++; continue }

    if (new Date(googleTs) > new Date(supabaseTs)) {
      toUpsert.push(ge)
    } else {
      // Supabase row is newer — app edit wins, skip this Google version
      skipped++
    }
  }

  if (toUpsert.length === 0) return { synced: 0, skipped }

  // Split: new events (not yet in Supabase) vs existing events being updated.
  // New events get a default colour; existing events must NOT have their colour
  // overwritten — the user may have changed it in the app.
  const newEvents      = toUpsert.filter((e) => !supabaseUpdatedMap.has(e.google_event_id))
  const existingEvents = toUpsert.filter((e) =>  supabaseUpdatedMap.has(e.google_event_id))

  if (newEvents.length > 0) {
    const inserts = newEvents.map((e) => ({ ...e, color: GOOGLE_DEFAULT_COLOR }))
    const { error } = await supabase.from("events").upsert(inserts, { onConflict: "google_event_id" })
    if (error) throw new Error(`Supabase insert failed: ${error.message}`)
  }

  if (existingEvents.length > 0) {
    // Update title/time/location/description but leave colour untouched
    const { error } = await supabase.from("events").upsert(existingEvents, { onConflict: "google_event_id" })
    if (error) throw new Error(`Supabase update failed: ${error.message}`)
  }

  return { synced: toUpsert.length, skipped }
}

// ── Create a new event in Google Calendar ─────────────────────────────────────

export interface EventCreate {
  title: string
  description: string | null
  location: string | null
  start_at: string
  end_at: string | null
  is_all_day: boolean
}

/**
 * Creates an event in Google Calendar and returns the new google_event_id.
 */
export async function createGoogleCalendarEvent(ev: EventCreate): Promise<string> {
  const calendar = getCalendarClient()

  const startDate = ev.start_at.slice(0, 10)
  const endDate   = ev.end_at ? ev.end_at.slice(0, 10) : startDate

  const { data } = await calendar.events.insert({
    calendarId:  CALENDAR_ID(),
    requestBody: {
      summary:     ev.title,
      description: ev.description ?? undefined,
      location:    ev.location ?? undefined,
      start: ev.is_all_day
        ? { date: startDate }
        : { dateTime: ev.start_at, timeZone: "UTC" },
      end: ev.is_all_day
        ? { date: endDate }
        : { dateTime: ev.end_at ?? ev.start_at, timeZone: "UTC" },
    },
  })

  if (!data.id) throw new Error("Google Calendar did not return an event id")
  return data.id
}

// ── Update an existing event in Google Calendar ───────────────────────────────

export interface EventPatch {
  google_event_id: string
  title: string
  description: string | null
  location: string | null
  start_at: string
  end_at: string | null
  is_all_day: boolean
}

export async function updateGoogleCalendarEvent(patch: EventPatch): Promise<void> {
  const calendar   = getCalendarClient()
  const calendarId = CALENDAR_ID()

  const makeDateTime = (iso: string) =>
    patch.is_all_day
      ? { date: iso.slice(0, 10) }
      : { dateTime: iso, timeZone: "UTC" }

  await calendar.events.patch({
    calendarId,
    eventId: patch.google_event_id,
    requestBody: {
      summary:     patch.title,
      description: patch.description ?? undefined,
      location:    patch.location ?? undefined,
      start:       makeDateTime(patch.start_at),
      end:         patch.end_at ? makeDateTime(patch.end_at) : undefined,
    },
  })
}

// ── Delete an event from Google Calendar ─────────────────────────────────────

export async function deleteGoogleCalendarEvent(googleEventId: string): Promise<void> {
  const calendar = getCalendarClient()
  await calendar.events.delete({
    calendarId: CALENDAR_ID(),
    eventId:    googleEventId,
  })
}
