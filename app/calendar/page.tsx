"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, RefreshCw, CalendarDays } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase"
import { useRealtimeChannel } from "@/lib/use-realtime"
import { ErrorBoundary } from "@/components/error-boundary"
import {
  addDays,
  buildCalendarGrid,
  isSameDay,
  layoutWeekEvents,
  startOfDay,
  type CalEvent,
} from "./_utils"
import { EventSheet, CreateEventButton } from "./_event-sheet"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// ── Stable realtime config (module-level so hook deps stay stable) ─────────────
const CALENDAR_TABLES = [{ table: "events" }, { table: "birthdays" }] as const

// ── Constants ─────────────────────────────────────────────────────────────────

const WEEKDAYS      = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const WEEKDAYS_MIN  = ["M", "T", "W", "T", "F", "S", "S"]
const MONTH_NAMES   = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** px reserved for the day-number badge at the top of each cell */
const DAY_H = 42
/** px per event track (bar height + gap) */
const TRACK_H = 26
/** fallback colour when an event has no colour set */
const DEFAULT_COLOR = "#3D6B57"
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
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "numeric", minute: "2-digit", hour12: true,
  })
}

// ── Birthday helpers ──────────────────────────────────────────────────────────

const BIRTHDAY_PREFIX = "bdoy-"

interface BirthdayRow { id:string; name:string; date:string; type:"birthday"|"anniversary"; color:string }

function birthdayOccurrencesInRange(birthdays:BirthdayRow[], start:Date, end:Date): CalEvent[] {
  const results:CalEvent[] = []
  for (const b of birthdays) {
    const [,m,d] = b.date.split("-").map(Number)
    for (let yr = start.getFullYear()-1; yr <= end.getFullYear()+1; yr++) {
      const occ = new Date(yr, m-1, d)
      if (occ >= start && occ <= end) {
        results.push({
          id: `${BIRTHDAY_PREFIX}${b.id}|${yr}`,
          title: `${b.type==="birthday"?"🎂":"❤️"} ${b.name}`,
          description: null, location: null,
          start_at: occ.toISOString(), end_at: null,
          is_all_day: true, color: b.color, google_event_id: null,
        })
      }
    }
  }
  return results
}

function daysUntilBirthday(dateStr:string, today:Date): number {
  const [,m,d] = dateStr.split("-").map(Number)
  const todayMs = today.getTime()
  let occ = new Date(today.getFullYear(), m-1, d)
  if (occ.getTime() < todayMs) occ = new Date(today.getFullYear()+1, m-1, d)
  return Math.round((occ.getTime()-todayMs)/86_400_000)
}

function formatBirthdayDate(dateStr:string):string {
  const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
  const [,m,d] = dateStr.split("-").map(Number)
  return `${MONTHS[m-1]} ${d}`
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
  // Desktop: day shown in the side panel
  const [selectedDay, setSelectedDay] = useState<Date>(today)

  const [birthdays, setBirthdays] = useState<BirthdayRow[]>([])
  const [selectedBirthday, setSelectedBirthday] = useState<BirthdayRow|null>(null)

  const supabase  = useRef(createClient()).current
  const agendaRef = useRef<HTMLDivElement>(null)

  const { year, month } = ym
  const weeks = useMemo(() => buildCalendarGrid(year, month), [year, month])

  const birthdayEvents = useMemo(():CalEvent[] => {
    if (!birthdays.length) return []
    const rangeStart = new Date(today.getFullYear()-1,0,1)
    const rangeEnd = new Date(today.getFullYear()+2,11,31)
    return birthdayOccurrencesInRange(birthdays, rangeStart, rangeEnd)
  }, [birthdays, today])

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

    const { data: bdData } = await supabase.from("birthdays").select("id,name,date,type,color")
    setBirthdays(bdData ?? [])

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

  function openBirthdayDetail(eventId:string) {
    const rowId = eventId.slice(BIRTHDAY_PREFIX.length).split("|")[0]
    const bd = birthdays.find(b=>b.id===rowId)
    if (bd) setSelectedBirthday(bd)
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
    setSelectedDay(today)
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
    const allEvents = [...events, ...birthdayEvents]
    for (let i = 0; i < AGENDA_DAYS; i++) {
      const d = addDays(agendaAnchor, i)
      const ds = toDateStr(d)
      const dayEvents = allEvents.filter((e) => {
        const start = startOfDay(new Date(e.start_at))
        const end   = e.end_at ? startOfDay(new Date(e.end_at)) : start
        return start <= d && end >= d
      })
      if (dayEvents.length > 0 || isSameDay(d, today)) {
        groups.push({ date: d, dateStr: ds, events: dayEvents })
      }
    }
    return groups
  }, [events, birthdayEvents, agendaAnchor, today])

  // ── Side panel data (desktop) ───────────────────────────────────────────────

  const allEvents = useMemo(() => [...events, ...birthdayEvents], [events, birthdayEvents])

  const eventsOn = useCallback((d: Date) => allEvents.filter((e) => {
    const start = startOfDay(new Date(e.start_at))
    const end   = e.end_at ? startOfDay(new Date(e.end_at)) : start
    return start <= d && end >= d
  }).sort((a, b) => Number(b.is_all_day) - Number(a.is_all_day) || a.start_at.localeCompare(b.start_at)),
  [allEvents])

  const selectedDayEvents = useMemo(() => eventsOn(selectedDay), [eventsOn, selectedDay])

  const comingUp = useMemo(() => {
    const out: { date: Date; event: CalEvent }[] = []
    for (let i = 1; i <= 14 && out.length < 5; i++) {
      const d = addDays(selectedDay, i)
      for (const e of eventsOn(d)) {
        if (isSameDay(startOfDay(new Date(e.start_at)), d)) out.push({ date: d, event: e })
        if (out.length >= 5) break
      }
    }
    return out
  }, [eventsOn, selectedDay])

  function openAny(ev: CalEvent) {
    if (ev.id.startsWith(BIRTHDAY_PREFIX)) openBirthdayDetail(ev.id)
    else openEvent(ev)
  }

  const isSelectedToday = isSameDay(selectedDay, today)

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col lg:h-full p-4 lg:px-8 lg:py-7 gap-4 lg:gap-5">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 lg:gap-3 shrink-0">
        <h1 className="font-display text-[26px] lg:text-[34px] font-semibold tracking-tight lg:min-w-[250px] mr-1">
          {MONTH_NAMES[month]} <span className="text-muted-foreground font-medium">{year}</span>
        </h1>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon" className="size-11 rounded-xl bg-card" onClick={handleStripPrevMonth} aria-label="Previous month">
            <ChevronLeft className="size-5" />
          </Button>
          <Button variant="outline" size="icon" className="size-11 rounded-xl bg-card" onClick={handleStripNextMonth} aria-label="Next month">
            <ChevronRight className="size-5" />
          </Button>
          <Button variant="outline" className="h-11 px-4 rounded-xl bg-card" onClick={goToday}>
            Today
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-2 lg:gap-3">
          <button
            type="button"
            onClick={triggerSync}
            disabled={syncing}
            className="hidden sm:flex items-center gap-2 h-11 px-3 rounded-xl text-sm font-medium text-muted-foreground hover:bg-card hover:text-foreground transition-colors disabled:opacity-70"
            aria-label="Sync with Google Calendar"
          >
            <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
            {syncing ? "Syncing…" : loading ? "Loading…" : lastSyncedAt ? `Synced ${formatSyncAge(lastSyncedAt)}` : "Sync Google Calendar"}
          </button>
          <Button variant="outline" size="icon" className="sm:hidden size-11 rounded-xl bg-card" onClick={triggerSync} disabled={syncing} aria-label="Sync with Google Calendar">
            <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
          </Button>
          <CreateEventButton />
        </div>
      </div>

      <ErrorBoundary label="Calendar grid">
      {/* ══════════════════════════════════════════════════════════════════
          DESKTOP: month grid + day panel
      ══════════════════════════════════════════════════════════════════ */}
      <div className="hidden lg:grid lg:flex-1 lg:min-h-0 gap-5" style={{ gridTemplateColumns: "minmax(0,1fr) 320px" }}>

        <div className="flex flex-col min-h-0 rounded-[28px] bg-card border border-border p-3 relative">
          {/* Weekday header row */}
          <div className="grid grid-cols-7 shrink-0 pb-2 pt-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-center text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground select-none">
                {d}
              </div>
            ))}
          </div>

          {loading && (
            <div className="absolute inset-x-3 top-12 z-20 flex flex-col gap-3 pointer-events-none">
              {[1, 2, 3].map((r) => (
                <div key={r} className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((c) => (
                    <Skeleton key={c} className="flex-1 h-5 rounded-lg" />
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Week rows */}
          <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
            {weeks.map((week, wi) => {
              const laid = layoutWeekEvents(allEvents, week)
              const trackCount = laid.reduce((m, e) => Math.max(m, e.track + 1), 0)
              const minRowH = Math.max(84, DAY_H + trackCount * TRACK_H + 10)

              return (
                <div key={wi} className="relative flex-1 grid grid-cols-7" style={{ minHeight: minRowH }}>
                  {week.map((day, di) => {
                    const inMonth  = day.getMonth() === month
                    const isToday  = isSameDay(day, today)
                    const selected = isSameDay(day, selectedDay)
                    return (
                      <button
                        key={di}
                        type="button"
                        onClick={() => setSelectedDay(startOfDay(day))}
                        aria-pressed={selected}
                        aria-label={day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
                        className="p-[3px] min-w-0 text-left"
                      >
                        <div className={cn(
                          "h-full rounded-2xl border-2 transition-colors",
                          selected ? "border-primary bg-accent/50"
                            : inMonth ? "border-transparent bg-background/50 hover:bg-secondary/60"
                            : "border-transparent hover:bg-secondary/40",
                        )}>
                          <div className="flex items-center h-[38px] px-1.5">
                            <span className={cn(
                              "flex items-center justify-center size-8 rounded-full text-[15px] font-semibold select-none leading-none tabular-nums",
                              isToday && "bg-foreground text-background",
                              !isToday && inMonth && "text-foreground",
                              !isToday && !inMonth && "text-muted-foreground/70",
                            )}>
                              {day.getDate()}
                            </span>
                          </div>
                        </div>
                      </button>
                    )
                  })}

                  {/* Event bars */}
                  {laid.map(({ event, startCol, endCol, track }) => {
                    const color = event.color || DEFAULT_COLOR
                    const isBirthday = event.id.startsWith(BIRTHDAY_PREFIX)
                    const daysAway = isBirthday ? Math.round((startOfDay(new Date(event.start_at)).getTime() - today.getTime()) / 86_400_000) : 0
                    return (
                      <button
                        type="button"
                        key={`${event.id}-w${wi}`}
                        title={event.title}
                        onClick={() => openAny(event)}
                        className={cn(
                          "absolute z-10 flex items-center gap-1.5 overflow-hidden whitespace-nowrap select-none",
                          "rounded-lg px-2 text-[12.5px] font-semibold leading-none text-foreground",
                          "hover:brightness-95 dark:hover:brightness-125 transition-[filter]",
                          isBirthday && daysAway === 0 && "font-bold",
                        )}
                        style={{
                          backgroundColor: `${color}2E`,
                          boxShadow: `inset 3px 0 0 ${color}`,
                          top: DAY_H + track * TRACK_H,
                          height: TRACK_H - 4,
                          left: `calc(${(startCol / 7) * 100}% + 8px)`,
                          width: `calc(${((endCol - startCol + 1) / 7) * 100}% - 16px)`,
                        }}
                      >
                        <span className="truncate">{event.title}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Day panel ─────────────────────────────────────────────────── */}
        <aside className="flex flex-col gap-5 min-h-0">
          <section className="rounded-[28px] bg-card border border-border p-6 flex flex-col gap-4 min-h-0">
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {isSelectedToday ? "Today" : selectedDay.toLocaleDateString("en-GB", { weekday: "long" })}
              </p>
              <h2 className="font-display text-[24px] font-semibold leading-tight">
                {selectedDay.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
              </h2>
            </div>

            {selectedDayEvents.length === 0 ? (
              <div className="rounded-2xl border-[1.5px] border-dashed border-input px-4 py-6 flex flex-col items-center gap-2 text-center">
                <CalendarDays className="size-6 text-muted-foreground" />
                <p className="text-[15px] text-muted-foreground">Nothing planned</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 overflow-y-auto min-h-0">
                {selectedDayEvents.map((ev) => (
                  <PanelEvent key={ev.id} ev={ev} onOpen={() => openAny(ev)} />
                ))}
              </div>
            )}
          </section>

          {comingUp.length > 0 && (
            <section className="rounded-[28px] bg-card border border-border p-6 flex flex-col gap-3.5 min-h-0">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Coming up</h2>
              {comingUp.map(({ date, event }) => (
                <button
                  key={`${event.id}-${toDateStr(date)}`}
                  type="button"
                  onClick={() => openAny(event)}
                  className="flex items-center gap-3 text-left rounded-xl -mx-2 px-2 py-1 hover:bg-secondary/60 transition-colors"
                >
                  <span className="flex w-11 shrink-0 flex-col items-center rounded-xl bg-secondary py-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.06em]">
                      {date.toLocaleDateString("en-GB", { weekday: "short" })}
                    </span>
                    <span className="font-display text-[18px] font-semibold leading-tight">{date.getDate()}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{event.title}</span>
                    <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                      <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: event.color || DEFAULT_COLOR }} />
                      {event.id.startsWith(BIRTHDAY_PREFIX) ? "All day" : event.is_all_day ? "All day" : formatTime(event.start_at)}
                    </span>
                  </span>
                </button>
              ))}
            </section>
          )}
        </aside>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          MOBILE: compact month strip + agenda list
      ══════════════════════════════════════════════════════════════════ */}
      <div className="lg:hidden flex flex-col gap-4">

        <div className="rounded-3xl bg-card border border-border p-2">
          <div className="grid grid-cols-7 pt-1">
            {WEEKDAYS_MIN.map((d, i) => (
              <div key={i} className="text-center text-[12px] font-semibold text-muted-foreground py-1">{d}</div>
            ))}
          </div>
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
                      if (!inMonth) setYm({ year: day.getFullYear(), month: day.getMonth() })
                    }}
                    className="flex items-center justify-center min-h-[44px]"
                    aria-label={day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
                  >
                    <span className={cn(
                      "relative flex flex-col items-center justify-center size-10 rounded-full transition-colors",
                      isAnchor ? "bg-primary text-primary-foreground"
                        : isToday ? "bg-foreground text-background"
                        : inMonth ? "text-foreground" : "text-muted-foreground/50",
                    )}>
                      <span className="text-[16px] font-semibold leading-none tabular-nums">{day.getDate()}</span>
                      {hasEvent && (
                        <span className={cn(
                          "absolute bottom-1 size-1 rounded-full",
                          isAnchor || isToday ? "bg-current" : "bg-primary",
                        )} />
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div ref={agendaRef} className="flex flex-col gap-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-3xl" />)}
            </div>
          ) : agendaGroups.length === 0 ? (
            <div className="rounded-3xl border-[1.5px] border-dashed border-input flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
              <CalendarDays className="size-8" />
              <p className="text-base font-semibold">Nothing coming up</p>
              <p className="text-sm text-center px-8">Nothing planned in the next {AGENDA_DAYS} days.</p>
            </div>
          ) : (
            agendaGroups.map(({ date, dateStr, events: dayEvents }) => {
              const isToday = isSameDay(date, today)
              return (
                <section key={dateStr} className="flex flex-col gap-2">
                  <h3 className={cn("px-1 text-[15px] font-semibold", isToday ? "text-primary" : "text-muted-foreground")}>
                    {isToday ? "Today · " : ""}
                    {date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
                  </h3>
                  {dayEvents.length === 0 ? (
                    <p className="rounded-2xl bg-card border border-border px-4 py-3 text-[15px] text-muted-foreground">Nothing planned</p>
                  ) : (
                    dayEvents.map((ev) => <PanelEvent key={ev.id} ev={ev} onOpen={() => openAny(ev)} today={today} />)
                  )}
                </section>
              )
            })
          )}
        </div>
      </div>

      </ErrorBoundary>

      {/* Event detail / edit sheet */}
      <EventSheet event={selectedEvent} open={sheetOpen} onClose={closeSheet} onSaved={fetchEvents} />

      {/* Birthday detail dialog */}
      {selectedBirthday && (
        <Dialog open={!!selectedBirthday} onOpenChange={o=>!o&&setSelectedBirthday(null)}>
          <DialogContent className="max-w-xs">
            <DialogHeader>
              <DialogTitle>{selectedBirthday.type==="birthday"?"🎂":"❤️"} {selectedBirthday.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {selectedBirthday.type==="birthday"?"Birthday":"Anniversary"} · {formatBirthdayDate(selectedBirthday.date)}
              </p>
              {(()=>{
                const days=daysUntilBirthday(selectedBirthday.date,today)
                return <p className="text-base font-semibold">{days===0?"🎉 Today!":days===1?"Tomorrow!":`in ${days} days`}</p>
              })()}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// ── Event card used in the day panel and mobile agenda ──────────────────────────

function PanelEvent({ ev, onOpen, today }: { ev: CalEvent; onOpen: () => void; today?: Date }) {
  const color = ev.color || DEFAULT_COLOR
  const isBirthday = ev.id.startsWith(BIRTHDAY_PREFIX)
  let when: string
  if (isBirthday) {
    const away = today ? Math.round((startOfDay(new Date(ev.start_at)).getTime() - today.getTime()) / 86_400_000) : null
    when = away === 0 ? "Today!" : away !== null && away > 0 ? `In ${away} days` : "All day"
  } else if (ev.is_all_day) {
    when = "All day"
  } else {
    when = formatTime(ev.start_at) + (ev.end_at ? ` to ${formatTime(ev.end_at)}` : "")
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full gap-3 rounded-2xl p-3.5 text-left transition-[filter] hover:brightness-95 dark:hover:brightness-125"
      style={{ backgroundColor: `${color}24` }}
    >
      <span className="w-1 shrink-0 self-stretch rounded-full" style={{ backgroundColor: color }} />
      <span className="min-w-0 flex-1 flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-[16px] font-semibold leading-snug">
          <span className="truncate">{ev.title}</span>
        </span>
        <span className="text-[14px] text-muted-foreground">{when}</span>
        {ev.location && <span className="text-[13px] text-muted-foreground truncate">{ev.location}</span>}
      </span>
    </button>
  )
}
