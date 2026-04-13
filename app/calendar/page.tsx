"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase"
import { useRealtimeChannel } from "@/lib/use-realtime"
import { ErrorBoundary } from "@/components/error-boundary"
import {
  addDays,
  buildCalendarGrid,
  chipTextColor,
  isSameDay,
  layoutWeekEvents,
  startOfDay,
  type CalEvent,
} from "./_utils"
import { EventSheet, CreateEventButton } from "./_event-sheet"

// ── Stable realtime config (module-level so hook deps stay stable) ─────────────
const CALENDAR_TABLES = [{ table: "events" }] as const

// ── Constants ─────────────────────────────────────────────────────────────────

const WEEKDAYS      = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const WEEKDAYS_MIN  = ["M", "T", "W", "T", "F", "S", "S"]
const MONTH_NAMES   = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** px reserved for the day-number badge at the top of each cell */
const DAY_H = 28
/** px per event track (bar height + gap) */
const TRACK_H = 22
/** fallback colour when an event has no colour set */
const DEFAULT_COLOR = "#3b82f6"
/** How many days ahead to show in the agenda view */
const AGENDA_DAYS = 90

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function formatSyncAge(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000)
  if (mins < 1) return "just now"
  if (mins === 1) return "1 min ago"
  return `${mins} mins ago`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "numeric", minute: "2-digit", hour12: true,
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const today = useMemo(() => startOfDay(new Date()), [])
  const [ym, setYm] = useState({
    year: today.getFullYear(),
    month: today.getMonth(),
  })
  const [events, setEvents]           = useState<CalEvent[]>([])
  const [loading, setLoading]         = useState(true)
  const [syncing, setSyncing]         = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)

  // Read from localStorage after mount to avoid SSR/client mismatch
  useEffect(() => {
    const v = localStorage.getItem("google-calendar-last-sync")
    if (v) setLastSyncedAt(parseInt(v))
  }, [])
  const [selectedEvent, setSelectedEvent] = useState<CalEvent | null>(null)
  const [sheetOpen, setSheetOpen]     = useState(false)
  // Mobile agenda: selected date for jumping (null = show from today)
  const [agendaAnchor, setAgendaAnchor] = useState<Date>(today)

  const supabase  = useRef(createClient()).current
  const agendaRef = useRef<HTMLDivElement>(null)

  const { year, month } = ym
  const weeks = useMemo(() => buildCalendarGrid(year, month), [year, month])

  // ── Data fetching ───────────────────────────────────────────────────────────

  const fetchEvents = useCallback(async () => {
    const grid = buildCalendarGrid(year, month)
    const gridStart = grid[0][0]
    const gridEnd   = grid[grid.length - 1][6]

    // For mobile agenda we also want AGENDA_DAYS from today
    const agendaEnd = addDays(today, AGENDA_DAYS)
    const rangeEnd  = new Date(
      Math.max(gridEnd.getTime(), agendaEnd.getTime()),
    )
    rangeEnd.setHours(23, 59, 59)

    const lookback = addDays(gridStart, -90).toISOString()

    const { data, error } = await supabase
      .from("events")
      .select("id, title, description, location, start_at, end_at, is_all_day, color, google_event_id")
      .gte("start_at", lookback)
      .lte("start_at", rangeEnd.toISOString())
      .order("start_at")

    if (error) { console.error("Failed to fetch events:", error.message); setLoading(false); return }

    const gs = startOfDay(gridStart)
    setEvents(
      (data ?? []).filter((e) => {
        const eEnd = e.end_at ? startOfDay(new Date(e.end_at)) : startOfDay(new Date(e.start_at))
        return eEnd >= gs
      }),
    )
    setLoading(false)
  }, [year, month, supabase, today])

  useEffect(() => { setLoading(true); fetchEvents() }, [fetchEvents])

  // ── Realtime subscription (with backoff reconnection + status reporting) ───
  useRealtimeChannel(supabase, `calendar-${year}-${month}`, CALENDAR_TABLES, fetchEvents)

  // ── Google Calendar sync ────────────────────────────────────────────────────

  const SYNC_KEY = "google-calendar-last-sync"
  const SYNC_TTL = 15 * 60 * 1000

  const triggerSync = useCallback(async () => {
    setSyncing(true)
    try {
      await fetch("/api/google-calendar/sync")
      const ts = Date.now()
      localStorage.setItem(SYNC_KEY, ts.toString())
      setLastSyncedAt(ts)
    } catch (err) {
      console.error("Google Calendar sync failed:", err)
    } finally {
      setSyncing(false)
    }
  }, [])

  useEffect(() => {
    const last = localStorage.getItem(SYNC_KEY)
    if (!last || Date.now() - parseInt(last) > SYNC_TTL) triggerSync()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tick every minute so "X mins ago" stays current
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  // ── Event sheet ─────────────────────────────────────────────────────────────

  function openEvent(event: CalEvent) { setSelectedEvent(event); setSheetOpen(true) }
  function closeSheet() {
    setSheetOpen(false)
    setTimeout(() => setSelectedEvent(null), 300)
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function prevMonth() {
    setYm(({ year, month }) =>
      month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 })
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function nextMonth() {
    setYm(({ year, month }) =>
      month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 })
  }
  function goToday() {
    setYm({ year: today.getFullYear(), month: today.getMonth() })
    setAgendaAnchor(today)
  }

  // When mobile strip month changes, sync agenda anchor to 1st of that month
  // (unless that month contains today, then anchor to today)
  function handleStripPrevMonth() {
    setYm(({ year, month }) => {
      const nm = month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
      const first = new Date(nm.year, nm.month, 1)
      setAgendaAnchor(isSameDay(first, today) || (today.getFullYear() === nm.year && today.getMonth() === nm.month) ? today : first)
      return nm
    })
  }
  function handleStripNextMonth() {
    setYm(({ year, month }) => {
      const nm = month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
      const first = new Date(nm.year, nm.month, 1)
      setAgendaAnchor(today.getFullYear() === nm.year && today.getMonth() === nm.month ? today : first)
      return nm
    })
  }

  // ── Agenda data ─────────────────────────────────────────────────────────────

  // Build (date, events[]) groups for the next AGENDA_DAYS days from agendaAnchor
  const agendaGroups = useMemo(() => {
    const groups: { date: Date; dateStr: string; events: CalEvent[] }[] = []
    for (let i = 0; i < AGENDA_DAYS; i++) {
      const d = addDays(agendaAnchor, i)
      const ds = toDateStr(d)
      const dayEvents = events.filter((e) => {
        const start = startOfDay(new Date(e.start_at))
        const end   = e.end_at ? startOfDay(new Date(e.end_at)) : start
        return start <= d && end >= d
      })
      if (dayEvents.length > 0 || isSameDay(d, today)) {
        groups.push({ date: d, dateStr: ds, events: dayEvents })
      }
    }
    return groups
  }, [events, agendaAnchor, today])

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col lg:h-full p-3 lg:p-4 gap-3">

      {/* ── Shared month navigation header ──────────────────────────────── */}
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="outline" size="icon"
          className="h-11 w-11 lg:h-8 lg:w-8"
          onClick={handleStripPrevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon"
          className="h-11 w-11 lg:h-8 lg:w-8"
          onClick={handleStripNextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <h2 className="text-lg font-semibold w-44 shrink-0">
          {MONTH_NAMES[month]} {year}
        </h2>
        <Button variant="outline" size="sm" className="h-11 px-4 lg:h-8 lg:px-3" onClick={goToday}>
          Today
        </Button>
        <Button variant="outline" size="sm" className="h-11 px-4 lg:h-8 lg:px-3 gap-1.5"
          onClick={triggerSync} disabled={syncing}>
          <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
          <span className="hidden sm:inline">Sync</span>
        </Button>
        {lastSyncedAt && !syncing && (
          <span className="hidden sm:inline text-xs text-muted-foreground">
            Synced {formatSyncAge(lastSyncedAt)}
          </span>
        )}
        {syncing && (
          <span className="hidden sm:inline text-xs text-muted-foreground animate-pulse">
            Syncing…
          </span>
        )}
        {loading && <span className="hidden sm:inline text-xs text-muted-foreground animate-pulse">Loading…</span>}
        <div className="ml-auto"><CreateEventButton /></div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          DESKTOP: monthly grid
      ══════════════════════════════════════════════════════════════════ */}
      <ErrorBoundary label="Calendar grid">
      <div className={cn(
        "hidden lg:flex flex-col border rounded-lg overflow-hidden bg-background relative",
        "lg:flex-1 lg:min-h-0",
      )}>
        {/* Weekday header row */}
        <div className="grid grid-cols-7 border-b bg-muted/40 shrink-0">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground select-none">
              {d}
            </div>
          ))}
        </div>

        {/* Skeleton overlay while loading */}
        {loading && (
          <div className="absolute inset-0 z-20 p-4 flex flex-col gap-3 pointer-events-none">
            {[1, 2, 3].map((r) => (
              <div key={r} className="flex gap-2">
                {[1, 2, 3, 4, 5].map((c) => (
                  <Skeleton key={c} className="flex-1 h-5 rounded" />
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Week rows */}
        <div className="flex flex-col flex-1 min-h-0">
          {weeks.map((week, wi) => {
            const laid = layoutWeekEvents(events, week)
            const trackCount = laid.reduce((m, e) => Math.max(m, e.track + 1), 0)
            const minRowH = Math.max(72, DAY_H + trackCount * TRACK_H + 6)

            return (
              <div key={wi} className="relative flex-1 grid grid-cols-7 border-b last:border-b-0"
                style={{ minHeight: minRowH }}>
                {week.map((day, di) => {
                  const inMonth = day.getMonth() === month
                  const isToday = isSameDay(day, today)
                  return (
                    <div key={di} className={cn(
                      "border-r last:border-r-0 p-1 min-w-0",
                      !isToday && !inMonth && "bg-muted/20",
                    )}
                    style={isToday ? { backgroundColor: "hsl(var(--primary) / 0.08)" } : undefined}
                    >
                      <div className="flex justify-center items-center h-7">
                        <span className={cn(
                          "flex items-center justify-center w-7 h-7 rounded-full",
                          "text-xs font-medium select-none leading-none",
                          isToday && "bg-primary text-primary-foreground font-bold",
                          !isToday && inMonth && "text-foreground",
                          !isToday && !inMonth && "text-muted-foreground",
                        )}>
                          {day.getDate()}
                        </span>
                      </div>
                    </div>
                  )
                })}

                {/* Event bars */}
                {laid.map(({ event, startCol, endCol, track }) => {
                  const bg = event.color || DEFAULT_COLOR
                  const fg = chipTextColor(bg)
                  const isSpanning = endCol > startCol
                  return (
                    <div key={`${event.id}-w${wi}`} title={event.title}
                      onClick={() => openEvent(event)}
                      className={cn(
                        "absolute z-10 flex items-center overflow-hidden",
                        "whitespace-nowrap cursor-pointer select-none",
                        "text-[11px] font-medium leading-none",
                        "hover:brightness-110 hover:shadow-sm transition-[filter,box-shadow]",
                        isSpanning ? "rounded-full px-2" : "rounded px-1.5",
                      )}
                      style={{
                        backgroundColor: bg, color: fg,
                        top: DAY_H + track * TRACK_H,
                        height: TRACK_H - 3,
                        left: `calc(${(startCol / 7) * 100}% + 2px)`,
                        width: `calc(${((endCol - startCol + 1) / 7) * 100}% - 4px)`,
                      }}
                    >
                      <span className="truncate">{event.title}</span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          MOBILE: compact month strip + agenda list
      ══════════════════════════════════════════════════════════════════ */}
      <div className="lg:hidden flex flex-col flex-1 min-h-0 gap-0 border rounded-lg overflow-hidden bg-background">

        {/* ── Compact month strip ─────────────────────────────────────── */}
        <div className="shrink-0 border-b bg-muted/20">
          {/* Weekday labels */}
          <div className="grid grid-cols-7 px-1 pt-1">
            {WEEKDAYS_MIN.map((d, i) => (
              <div key={i} className="text-center text-[10px] font-medium text-muted-foreground py-1">
                {d}
              </div>
            ))}
          </div>
          {/* Day cells */}
          <div className="px-1 pb-1">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7">
                {week.map((day, di) => {
                  const inMonth  = day.getMonth() === month
                  const isToday  = isSameDay(day, today)
                  const isAnchor = isSameDay(day, agendaAnchor)
                  const hasEvent = events.some((e) => {
                    const s = startOfDay(new Date(e.start_at))
                    const en = e.end_at ? startOfDay(new Date(e.end_at)) : s
                    return s <= day && en >= day
                  })
                  return (
                    <button
                      key={di}
                      onClick={() => {
                        setAgendaAnchor(startOfDay(day))
                        // Keep month strip in sync if tapping an adjacent-month day
                        if (!inMonth) {
                          setYm({ year: day.getFullYear(), month: day.getMonth() })
                        }
                      }}
                      className={cn(
                        "relative flex flex-col items-center justify-center",
                        "min-h-[44px] rounded-lg transition-colors",
                        isAnchor
                          ? "bg-primary text-primary-foreground"
                          : isToday
                          ? "text-primary font-bold"
                          : inMonth
                          ? "text-foreground hover:bg-muted"
                          : "text-muted-foreground/50 hover:bg-muted",
                      )}
                    >
                      <span className="text-sm leading-none">{day.getDate()}</span>
                      {hasEvent && (
                        <span className={cn(
                          "mt-0.5 h-1 w-1 rounded-full",
                          isAnchor ? "bg-primary-foreground" : "bg-primary",
                        )} />
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* ── Agenda list ─────────────────────────────────────────────── */}
        <div ref={agendaRef} className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-4 space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-8 rounded" />
                  <Skeleton className="h-12 rounded" />
                </div>
              ))}
            </div>
          ) : agendaGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <span className="text-5xl select-none">📅</span>
              <p className="text-base font-medium">No upcoming events</p>
              <p className="text-sm text-center px-8">
                Nothing planned in the next {AGENDA_DAYS} days.<br />Tap <strong>+ New Event</strong> to add one.
              </p>
            </div>
          ) : (
            agendaGroups.map(({ date, dateStr, events: dayEvents }) => {
              const isToday = isSameDay(date, today)
              return (
                <div key={dateStr}>
                  {/* Date heading */}
                  <div className={cn(
                    "sticky top-0 z-10 px-4 py-2 border-b",
                    isToday
                      ? "bg-primary/10 border-primary/20"
                      : "bg-muted/40",
                  )}>
                    <span className={cn(
                      "text-sm font-semibold",
                      isToday ? "text-primary" : "text-foreground",
                    )}>
                      {isToday ? "Today · " : ""}
                      {date.toLocaleDateString("en-AU", {
                        weekday: "short", day: "numeric", month: "short",
                      })}
                    </span>
                  </div>

                  {/* Events for this day */}
                  {dayEvents.length === 0 ? (
                    <div className="px-4 py-3">
                      <span className="text-sm text-muted-foreground italic">No events</span>
                    </div>
                  ) : (
                    dayEvents.map((ev) => (
                      <button
                        key={ev.id}
                        onClick={() => openEvent(ev)}
                        className="w-full flex items-start gap-3 px-4 py-3 border-b last:border-b-0 hover:bg-muted/30 transition-colors text-left min-h-[44px]"
                      >
                        {/* Colour stripe */}
                        <div
                          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: ev.color ?? DEFAULT_COLOR }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium leading-snug">{ev.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatTime(ev.start_at)}
                            {ev.end_at && <> – {formatTime(ev.end_at)}</>}
                          </p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      </ErrorBoundary>

      {/* Event detail / edit sheet */}
      <EventSheet event={selectedEvent} open={sheetOpen} onClose={closeSheet} />
    </div>
  )
}
