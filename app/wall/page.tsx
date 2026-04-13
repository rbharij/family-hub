"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { X, CheckCircle2, Circle } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase"
import { useRealtimeChannel } from "@/lib/use-realtime"
import { ErrorBoundary } from "@/components/error-boundary"

// ── Stable realtime config ─────────────────────────────────────────────────────
const WALL_TABLES = [
  { table: "events" },
  { table: "chores" },
  { table: "meals" },
  { table: "messages" },
  { table: "birthdays" },
] as const

// ── Local types ────────────────────────────────────────────────────────────────

interface CalEvent {
  id: string
  title: string
  start_at: string
  end_at: string | null
  color: string | null
}

interface Member {
  id: string
  name: string
  avatar_emoji: string | null
  color: string | null
}

interface Chore {
  id: string
  title: string
  assigned_to: string | null
  completed: boolean
  completed_at: string | null
  pocket_money_value: number
}

interface Meal {
  id: string
  title: string
  meal_type: string
  date: string
  notes: string | null
  for_member_id: string | null
}

interface WallMessage {
  id: string
  from_member_id: string | null
  to_member_id: string
  body: string
  created_at: string
  dismissed_at: string | null
}

interface BirthdayRow { id:string; name:string; date:string; type:"birthday"|"anniversary"; color:string }

interface Weather {
  temp: number          // °C
  feelsLike: number
  code: number          // WMO weather code
  isDay: boolean
}

// ── Weather helpers ────────────────────────────────────────────────────────────

function weatherEmoji(code: number, isDay: boolean): string {
  if (code === 0)                        return isDay ? "☀️" : "🌙"
  if (code <= 2)                         return isDay ? "🌤️" : "☁️"
  if (code === 3)                        return "☁️"
  if (code <= 48)                        return "🌫️"
  if (code <= 57)                        return "🌦️"
  if (code <= 67)                        return "🌧️"
  if (code <= 77)                        return "❄️"
  if (code <= 82)                        return "🌦️"
  if (code <= 86)                        return "🌨️"
  return "⛈️"
}

function weatherDesc(code: number): string {
  if (code === 0)   return "Clear"
  if (code === 1)   return "Mostly clear"
  if (code === 2)   return "Partly cloudy"
  if (code === 3)   return "Overcast"
  if (code <= 48)   return "Foggy"
  if (code <= 55)   return "Drizzle"
  if (code <= 57)   return "Freezing drizzle"
  if (code <= 65)   return "Rain"
  if (code <= 67)   return "Freezing rain"
  if (code <= 77)   return "Snow"
  if (code <= 82)   return "Rain showers"
  if (code <= 86)   return "Snow showers"
  return "Thunderstorm"
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function formatEventTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

function formatEventDay(isoStr: string, todayStr: string): string {
  const d = new Date(isoStr)
  const dStr = toDateStr(d)
  if (dStr === todayStr) return "Today"
  return d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" })
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function WallPage() {
  const router = useRouter()
  const supabase = useRef(createClient()).current

  // Clock
  const [now, setNow] = useState<Date>(() => new Date())

  // Weather
  const [weather, setWeather] = useState<Weather | null>(null)

  useEffect(() => {
    if (!navigator.geolocation) return

    function fetchWeather(lat: number, lon: number) {
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,apparent_temperature,weather_code,is_day` +
        `&timezone=auto`,
      )
        .then((r) => r.json())
        .then((d) => {
          const c = d.current
          setWeather({
            temp:      Math.round(c.temperature_2m),
            feelsLike: Math.round(c.apparent_temperature),
            code:      c.weather_code,
            isDay:     c.is_day === 1,
          })
        })
        .catch(() => {/* silently ignore */})
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => fetchWeather(pos.coords.latitude, pos.coords.longitude),
      () => {/* permission denied — no weather shown */},
    )

    // Refresh weather every 15 minutes
    const id = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (pos) => fetchWeather(pos.coords.latitude, pos.coords.longitude),
        () => {},
      )
    }, 15 * 60_000)
    return () => clearInterval(id)
  }, [])

  // Data
  const [events, setEvents]           = useState<CalEvent[]>([])
  const [birthdays, setBirthdays]     = useState<BirthdayRow[]>([])
  const [members, setMembers]         = useState<Member[]>([])
  const [chores, setChores]           = useState<Chore[]>([])
  const [dinnerToday, setDinnerToday]         = useState<Meal | null>(null)
  const [lunchboxesToday, setLunchboxesToday] = useState<Meal[]>([])
  const [dinnerTomorrow, setDinnerTomorrow]   = useState<Meal | null>(null)
  const [lunchboxesTomorrow, setLunchboxesTomorrow] = useState<Meal[]>([])
  const [wallMessages, setWallMessages]       = useState<WallMessage[]>([])
  const [wallMsgFilter, setWallMsgFilter]     = useState<Set<string>>(new Set())

  // ── Clock tick ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // ── Fetch all data ─────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow    = addDays(today, 1)
    const weekEnd     = addDays(today, 7)
    const todayStr    = toDateStr(today)
    const tomorrowStr = toDateStr(tomorrow)

    const [eventsRes, membersRes, choresRes, mealsRes, msgsRes, bdRes] = await Promise.all([
      supabase
        .from("events")
        .select("id, title, start_at, end_at, color")
        .gte("start_at", today.toISOString())
        .lt("start_at", weekEnd.toISOString())
        .order("start_at"),
      supabase
        .from("family_members")
        .select("id, name, avatar_emoji, color")
        .order("created_at"),
      supabase
        .from("chores")
        .select("id, title, assigned_to, completed, completed_at, pocket_money_value")
        .eq("due_date", todayStr),
      supabase
        .from("meals")
        .select("id, title, meal_type, date, notes, for_member_id")
        .in("date", [todayStr, tomorrowStr]),
      supabase
        .from("messages")
        .select("id, from_member_id, to_member_id, body, created_at, dismissed_at")
        .is("dismissed_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("birthdays")
        .select("id, name, date, type, color"),
    ])

    setEvents(eventsRes.data ?? [])
    setBirthdays(bdRes.data ?? [])
    const memberList = membersRes.data ?? []
    setMembers(memberList)
    // Initialise wall message filter to all members on first load
    setWallMsgFilter((prev) => prev.size === 0 ? new Set(memberList.map((m) => m.id)) : prev)
    setChores(choresRes.data ?? [])
    setWallMessages(msgsRes.data ?? [])

    const meals = mealsRes.data ?? []
    setDinnerToday(meals.find((m) => m.date === todayStr       && m.meal_type === "dinner")   ?? null)
    setDinnerTomorrow(meals.find((m) => m.date === tomorrowStr && m.meal_type === "dinner")   ?? null)
    setLunchboxesToday(meals.filter((m) => m.date === todayStr    && m.meal_type === "lunchbox"))
    setLunchboxesTomorrow(meals.filter((m) => m.date === tomorrowStr && m.meal_type === "lunchbox"))
  }, [supabase])

  // Initial fetch + 60 s auto-refresh
  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, 60_000)
    return () => clearInterval(id)
  }, [fetchAll])

  // ── Realtime (with backoff reconnection + status reporting) ──────────────
  useRealtimeChannel(supabase, "wall-realtime", WALL_TABLES, fetchAll)

  // ── Chore toggle ───────────────────────────────────────────────────────────

  async function toggleChore(chore: Chore) {
    const completed = !chore.completed
    // Optimistic update
    setChores((prev) => prev.map((c) => c.id === chore.id ? { ...c, completed } : c))
    const { error } = await supabase
      .from("chores")
      .update({
        completed,
        completed_at: completed ? new Date().toISOString() : null,
      })
      .eq("id", chore.id)
    if (error) {
      setChores((prev) => prev.map((c) => c.id === chore.id ? chore : c))
      toast.error("Couldn't update chore.")
    }
  }

  // ── Wall message filter ────────────────────────────────────────────────────

  function toggleWallMsgFilter(id: string) {
    setWallMsgFilter((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── Dismiss message ────────────────────────────────────────────────────────

  async function dismissMessage(id: string) {
    const now = new Date().toISOString()
    setWallMessages((prev) => prev.filter((m) => m.id !== id))
    await supabase.from("messages").update({ dismissed_at: now }).eq("id", id)
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const memberMap = new Map(members.map((m) => [m.id, m]))

  const upcomingBirthdays = useMemo(() => {
    const todayMs = (() => { const d=new Date(); d.setHours(0,0,0,0); return d.getTime() })()
    return birthdays
      .map(b => {
        const [,m,d2] = b.date.split("-").map(Number)
        let occ = new Date(new Date().getFullYear(), m-1, d2)
        if (occ.getTime() < todayMs) occ = new Date(new Date().getFullYear()+1, m-1, d2)
        return { ...b, daysAway: Math.round((occ.getTime()-todayMs)/86_400_000) }
      })
      .filter(b => b.daysAway <= 7)
      .sort((a,b) => a.daysAway - b.daysAway)
  }, [birthdays])

  // Group chores by assigned member (preserve insertion order)
  const choreGroupMap = new Map<string, Chore[]>()
  for (const chore of chores) {
    const key = chore.assigned_to ?? "__none__"
    if (!choreGroupMap.has(key)) choreGroupMap.set(key, [])
    choreGroupMap.get(key)!.push(chore)
  }
  const choreGroups = Array.from(choreGroupMap.entries()).map(([key, items]) => ({
    member: key === "__none__" ? null : (memberMap.get(key) ?? null),
    key,
    items,
  }))

  // Clock display
  const hh = String(now.getHours()).padStart(2, "0")
  const mm = String(now.getMinutes()).padStart(2, "0")
  const ss = String(now.getSeconds()).padStart(2, "0")
  const dateLabel = now.toLocaleDateString("en-AU", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-background text-foreground flex flex-col overflow-hidden select-none">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b bg-background px-6 py-3 flex items-center gap-5">
        <div className="flex items-center gap-6">
          {/* Clock */}
          <div className="flex items-baseline gap-4">
            <span className="text-[64px] font-bold tabular-nums leading-none tracking-tight">
              {hh}:{mm}
              <span className="text-[36px] text-muted-foreground/60 ml-1">{ss}</span>
            </span>
            <div>
              <p className="text-xl text-foreground font-medium">{dateLabel}</p>
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mt-0.5">
                Family Hub
              </p>
            </div>
          </div>

          {/* Weather */}
          {weather && (
            <div className="flex items-center gap-3 pl-6 border-l border-border">
              <span className="text-[52px] leading-none">{weatherEmoji(weather.code, weather.isDay)}</span>
              <div>
                <p className="text-[36px] font-bold leading-none tabular-nums">
                  {weather.temp}°
                </p>
                <p className="text-sm text-muted-foreground mt-1">{weatherDesc(weather.code)}</p>
                <p className="text-xs text-muted-foreground">
                  Feels like {weather.feelsLike}°
                </p>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => router.back()}
          className="ml-auto flex items-center gap-2 rounded-xl border px-4 py-2.5 text-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="h-5 w-5" />
          Exit
        </button>
      </header>

      {/* ── 2×2 Grid ───────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2">

        {/* ── Top Left: This Week's Events ──────────────────────────────── */}
        <ErrorBoundary label="This week's events">
        <section className="border-r border-b flex flex-col overflow-hidden">
          <div className="shrink-0 px-6 pt-5 pb-3 border-b bg-muted/30">
            <h2 className="text-[28px] font-bold leading-none">📅 This Week</h2>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {events.length === 0 ? (
              <p className="text-xl text-muted-foreground italic mt-2">No events this week</p>
            ) : (() => {
              // Group by day label
              const groups: { day: string; items: typeof events }[] = []
              for (const ev of events) {
                const day = formatEventDay(ev.start_at, toDateStr(new Date()))
                const last = groups[groups.length - 1]
                if (last?.day === day) last.items.push(ev)
                else groups.push({ day, items: [ev] })
              }
              return groups.map(({ day, items }) => (
                <div key={day}>
                  <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-2">
                    {day}
                  </p>
                  <div className="space-y-2.5">
                    {items.map((ev) => (
                      <div key={ev.id} className="flex items-start gap-4">
                        <div
                          className="mt-2 h-3.5 w-3.5 shrink-0 rounded-full"
                          style={{ backgroundColor: ev.color ?? "#3b82f6" }}
                        />
                        <div className="min-w-0">
                          <p className="text-xl font-semibold leading-snug">{ev.title}</p>
                          <p className="text-lg text-muted-foreground mt-0.5">
                            {formatEventTime(ev.start_at)}
                            {ev.end_at ? <> &ndash; {formatEventTime(ev.end_at)}</> : null}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            })()}
          </div>

          {upcomingBirthdays.length > 0 && (
            <div className="shrink-0 border-t bg-muted/20 px-6 py-3 space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Coming up</p>
              {upcomingBirthdays.map(b => (
                <div key={b.id} className="flex items-center gap-2">
                  <span className="text-lg leading-none">{b.type==="birthday"?"🎂":"❤️"}</span>
                  <span className="text-base font-medium flex-1">{b.name}</span>
                  <span className="text-sm text-muted-foreground shrink-0">
                    {b.daysAway===0?"Today! 🎉":`${b.daysAway} day${b.daysAway!==1?"s":""}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
        </ErrorBoundary>

        {/* ── Top Right: Today's Chores ──────────────────────────────────── */}
        <ErrorBoundary label="Today's chores">
        <section className="border-b flex flex-col overflow-hidden">
          <div className="shrink-0 px-6 pt-5 pb-3 border-b bg-muted/30">
            <h2 className="text-[28px] font-bold leading-none">✅ Today&apos;s Chores</h2>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
            {chores.length === 0 ? (
              <p className="text-xl text-muted-foreground italic mt-2">No chores today</p>
            ) : (
              choreGroups.map(({ member, key, items }) => (
                <div key={key}>
                  {/* Member heading */}
                  <div className="flex items-center gap-2 mb-2">
                    {member?.avatar_emoji && (
                      <span className="text-2xl leading-none">{member.avatar_emoji}</span>
                    )}
                    <span
                      className="text-xl font-bold"
                      style={member?.color ? { color: member.color } : undefined}
                    >
                      {member?.name ?? "Unassigned"}
                    </span>
                  </div>
                  {/* Chore rows */}
                  <div className="space-y-2 pl-1">
                    {items.map((chore: Chore) => (
                      <button
                        key={chore.id}
                        onClick={() => toggleChore(chore)}
                        className="flex items-center gap-3 w-full text-left group cursor-pointer"
                      >
                        {chore.completed ? (
                          <CheckCircle2 className="h-7 w-7 shrink-0 text-green-500" />
                        ) : (
                          <Circle className="h-7 w-7 shrink-0 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                        )}
                        <span className={cn(
                          "text-lg leading-snug flex-1",
                          chore.completed && "line-through text-muted-foreground",
                        )}>
                          {chore.title}
                        </span>
                        {chore.pocket_money_value > 0 && (
                          <span className="text-lg text-muted-foreground shrink-0 tabular-nums">
                            S${chore.pocket_money_value.toFixed(2)}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
        </ErrorBoundary>

        {/* ── Bottom Left: Meals ─────────────────────────────────────────── */}
        <ErrorBoundary label="Meals panel">
        <section className="border-r flex flex-col overflow-hidden">
          {/* Section title */}
          <div className="shrink-0 px-6 pt-5 pb-3 border-b bg-muted/30">
            <h2 className="text-[28px] font-bold leading-none">🍽 Meals</h2>
          </div>

          {/* Split: left = today, right = tomorrow */}
          <div className="flex-1 min-h-0 flex flex-row divide-x">

            {/* ── Today ── */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <div className="shrink-0 px-4 py-2 bg-muted/20 border-b">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Today</p>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
                <MealDayPanel dinner={dinnerToday} lunchboxes={lunchboxesToday} memberMap={memberMap} />
              </div>
            </div>

            {/* ── Tomorrow ── */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <div className="shrink-0 px-4 py-2 bg-muted/20 border-b">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Tomorrow</p>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
                <MealDayPanel dinner={dinnerTomorrow} lunchboxes={lunchboxesTomorrow} memberMap={memberMap} />
              </div>
            </div>

          </div>
        </section>
        </ErrorBoundary>

        {/* ── Bottom Right: Messages ─────────────────────────────────────── */}
        <ErrorBoundary label="Messages panel">
        <section className="flex flex-col overflow-hidden">
          <div className="shrink-0 px-6 pt-4 pb-3 border-b bg-muted/30">
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-[28px] font-bold leading-none flex-1">💬 Messages</h2>
              {wallMessages.length > 0 && (
                <span className="inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold min-w-[28px] h-7 px-2">
                  {wallMessages.length}
                </span>
              )}
            </div>
            {/* Compact member filter buttons */}
            {members.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {members.map((m) => {
                  const selected = wallMsgFilter.has(m.id)
                  return (
                    <button
                      key={m.id}
                      onClick={() => toggleWallMsgFilter(m.id)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold transition-all border-2",
                        !selected && "opacity-40",
                      )}
                      style={{
                        backgroundColor: selected && m.color ? `${m.color}20` : undefined,
                        color: selected && m.color ? m.color : undefined,
                        borderColor: selected && m.color ? m.color : "transparent",
                      }}
                    >
                      {m.avatar_emoji && <span className="text-base leading-none">{m.avatar_emoji}</span>}
                      <span className="text-sm">{m.name}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {(() => {
              // Apply filter
              const filtered = wallMsgFilter.size === 0
                ? wallMessages
                : wallMessages.filter((m) => wallMsgFilter.has(m.to_member_id))

              if (filtered.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                    <span className="text-4xl">💬</span>
                    <p className="text-xl italic">No messages — all caught up!</p>
                  </div>
                )
              }

              // Group by recipient
              const groups = new Map<string, WallMessage[]>()
              for (const msg of filtered) {
                const g = groups.get(msg.to_member_id) ?? []
                g.push(msg)
                groups.set(msg.to_member_id, g)
              }
              return Array.from(groups.entries()).map(([toId, msgs]) => {
                const recipient = memberMap.get(toId)
                return (
                  <div key={toId} className="space-y-2">
                    {/* Recipient chip */}
                    {recipient && (
                      <div
                        className="inline-flex items-center gap-2 rounded-full px-3 py-1"
                        style={{
                          backgroundColor: recipient.color ? `${recipient.color}20` : undefined,
                          color: recipient.color ?? undefined,
                        }}
                      >
                        {recipient.avatar_emoji && (
                          <span className="text-xl leading-none">{recipient.avatar_emoji}</span>
                        )}
                        <span className="text-base font-bold">{recipient.name}</span>
                      </div>
                    )}
                    {msgs.map((msg) => {
                      const sender = msg.from_member_id ? memberMap.get(msg.from_member_id) : null
                      return (
                        <div key={msg.id}
                          className="relative rounded-xl border bg-card px-4 py-3 pr-10">
                          <p className="text-[18px] leading-snug font-medium">{msg.body}</p>
                          <p className="text-sm text-muted-foreground mt-1.5">
                            {sender
                              ? `From ${sender.avatar_emoji ?? ""} ${sender.name} · `
                              : ""}
                            {new Date(msg.created_at).toLocaleTimeString("en-AU", {
                              hour: "numeric", minute: "2-digit", hour12: true,
                            })}
                          </p>
                          <button
                            onClick={() => dismissMessage(msg.id)}
                            className="absolute top-3 right-3 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            aria-label="Dismiss"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )
              })
            })()}
          </div>
        </section>
        </ErrorBoundary>

      </div>
    </div>
  )
}

// ── Meal day panel ─────────────────────────────────────────────────────────────

function MealDayPanel({
  dinner, lunchboxes, memberMap,
}: {
  dinner: Meal | null
  lunchboxes: Meal[]
  memberMap: Map<string, Member>
}) {
  const hasAnything = dinner || lunchboxes.length > 0
  if (!hasAnything) {
    return <p className="text-lg text-muted-foreground italic">Not planned yet</p>
  }
  return (
    <>
      {dinner && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            🍽️ Dinner
          </p>
          <p className="text-[22px] font-bold leading-snug">{dinner.title}</p>
          {dinner.notes && (
            <p className="text-base text-muted-foreground mt-0.5 leading-snug">{dinner.notes}</p>
          )}
        </div>
      )}

      {lunchboxes.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            🥪 Lunchboxes
          </p>
          {lunchboxes.map((lunch) => {
            const child = lunch.for_member_id ? memberMap.get(lunch.for_member_id) : null
            return (
              <div key={lunch.id} className="flex items-start gap-3">
                {child && (
                  <div
                    className="shrink-0 flex items-center justify-center rounded-full w-8 h-8 text-base font-bold mt-0.5"
                    style={{
                      backgroundColor: child.color ? `${child.color}25` : undefined,
                      color: child.color ?? undefined,
                    }}
                  >
                    {child.avatar_emoji ?? child.name[0]}
                  </div>
                )}
                <div className="min-w-0">
                  {child && (
                    <p className="text-xs font-bold uppercase tracking-wider mb-0.5"
                      style={{ color: child.color ?? undefined }}>
                      {child.name}
                    </p>
                  )}
                  <p className="text-[20px] font-bold leading-snug">{lunch.title}</p>
                  {lunch.notes && (
                    <p className="text-base text-muted-foreground mt-0.5 leading-snug">{lunch.notes}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
