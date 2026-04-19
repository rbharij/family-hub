"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { X, CheckCircle2, Circle } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase"
import { useRealtimeChannel } from "@/lib/use-realtime"
import { ErrorBoundary } from "@/components/error-boundary"
import { GrowingPlant } from "@/app/plants/_growing-plant"

// ── Stable realtime config ─────────────────────────────────────────────────────
const WALL_TABLES = [
  { table: "events" },
  { table: "chores" },
  { table: "chore_streaks" },
  { table: "meals" },
  { table: "messages" },
  { table: "birthdays" },
  { table: "member_weekly_plants" },
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
interface WallChoreStreak { member_id: string; streak_count: number; longest_streak: number }
interface WallMemberPlant { plant_id: string; member_id: string }

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
  const [nextDinners, setNextDinners]         = useState<{ dateStr: string; label: string; dinner: Meal | null }[]>([])
  const [wallMessages, setWallMessages]       = useState<WallMessage[]>([])
  const [choreStreaks, setChoreStreaks]        = useState<Map<string, WallChoreStreak>>(new Map())
  const [wallMemberPlants, setWallMemberPlants] = useState<WallMemberPlant[]>([])

  // ── Clock tick ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // ── Fetch all data ─────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const weekEnd  = addDays(today, 7)
    const todayStr = toDateStr(today)
    const d1Str    = toDateStr(addDays(today, 1))
    const d2Str    = toDateStr(addDays(today, 2))
    const d3Str    = toDateStr(addDays(today, 3))

    // Compute Monday of current week for weekly_plants query
    const weekMonday = new Date(today)
    const wdOffset = (weekMonday.getDay() + 6) % 7
    weekMonday.setDate(weekMonday.getDate() - wdOffset)
    const pad2 = (n: number) => String(n).padStart(2, "0")
    const weekMondayStr = `${weekMonday.getFullYear()}-${pad2(weekMonday.getMonth() + 1)}-${pad2(weekMonday.getDate())}`

    const [eventsRes, membersRes, choresRes, mealsRes, msgsRes, bdRes, streaksRes, wpRes] = await Promise.all([
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
        .in("date", [todayStr, d1Str, d2Str, d3Str]),
      supabase
        .from("messages")
        .select("id, from_member_id, to_member_id, body, created_at, dismissed_at")
        .is("dismissed_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("birthdays")
        .select("id, name, date, type, color"),
      supabase
        .from("chore_streaks")
        .select("member_id, streak_count, longest_streak"),
      supabase
        .from("member_weekly_plants")
        .select("plant_id, member_id")
        .eq("week_start", weekMondayStr),
    ])

    setEvents(eventsRes.data ?? [])
    setBirthdays(bdRes.data ?? [])
    const streakMap = new Map<string, WallChoreStreak>()
    for (const row of (streaksRes.data ?? []) as WallChoreStreak[]) {
      streakMap.set(row.member_id, row)
    }
    setChoreStreaks(streakMap)

    // Build wall member plants
    setWallMemberPlants((wpRes.data ?? []) as WallMemberPlant[])
    const memberList = membersRes.data ?? []
    setMembers(memberList)
    setChores(choresRes.data ?? [])
    setWallMessages(msgsRes.data ?? [])

    const meals = mealsRes.data ?? []
    setDinnerToday(meals.find((m) => m.date === todayStr && m.meal_type === "dinner") ?? null)
    setLunchboxesToday(meals.filter((m) => m.date === todayStr && m.meal_type === "lunchbox"))

    // Next 3 days' dinners for the compact upcoming strip
    setNextDinners([d1Str, d2Str, d3Str].map((dateStr) => {
      const [y, mo, da] = dateStr.split("-").map(Number)
      const label = new Date(y, mo - 1, da).toLocaleDateString("en-AU", { weekday: "short" })
      return { dateStr, label, dinner: meals.find((m) => m.date === dateStr && m.meal_type === "dinner") ?? null }
    }))
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
      toast.error("Couldn't update task.")
    }
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

      {/* ── 3-column grid: [2fr 2fr 1fr] × 2 rows ─────────────────────── */}
      <div className="flex-1 min-h-0 grid grid-rows-[3fr_2fr]" style={{ gridTemplateColumns: "2fr 2fr 1fr" }}>

        {/* ── Top Left: Meals ───────────────────────────────────────────── */}
        <ErrorBoundary label="Meals panel">
        <section className="border-r border-b flex flex-col overflow-hidden">
          <div className="shrink-0 px-6 pt-5 pb-3 border-b bg-muted/30">
            <h2 className="text-[28px] font-bold leading-none">🍽 Meals</h2>
          </div>
          {/* Tonight: full detail */}
          <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
            <MealDayPanel dinner={dinnerToday} lunchboxes={lunchboxesToday} memberMap={memberMap} />
          </div>
          {/* Upcoming 3 days — compact dinner strip */}
          <div className="shrink-0 border-t bg-muted/20 px-6 py-3 flex flex-col gap-1.5">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Coming up</p>
            {nextDinners.map(({ dateStr, label, dinner }) => (
              <div key={dateStr} className="flex items-baseline gap-2">
                <span className="text-sm font-bold text-muted-foreground w-8 shrink-0">{label}</span>
                <span className={cn("text-base leading-snug", dinner ? "font-semibold" : "text-muted-foreground/60")}>
                  {dinner ? dinner.title : "—"}
                </span>
              </div>
            ))}
          </div>
        </section>
        </ErrorBoundary>

        {/* ── Top Right: Today's Chores ──────────────────────────────────── */}
        <ErrorBoundary label="Today's tasks">
        <section className="border-b flex flex-col overflow-hidden">
          <div className="shrink-0 px-6 pt-5 pb-3 border-b bg-muted/30">
            <h2 className="text-[28px] font-bold leading-none">✅ Today&apos;s Tasks</h2>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
            {chores.length === 0 ? (
              <p className="text-xl text-muted-foreground italic mt-2">No tasks today</p>
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
                    {member && (() => {
                      const s = choreStreaks.get(member.id)
                      if (!s || s.streak_count < 1) return null
                      const isHot = s.streak_count >= 7
                      return (
                        <span
                          className={cn("font-bold tabular-nums", isHot ? "text-2xl text-orange-500" : "text-xl text-amber-500")}
                          style={isHot ? { textShadow: "0 0 8px #f59e0b, 0 0 16px #f59e0b80" } : undefined}
                        >
                          🔥 {s.streak_count}
                        </span>
                      )
                    })()}
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

        {/* ── Bottom Left: This Week's Events ───────────────────────────── */}
        <ErrorBoundary label="This week's events">
        <section className="border-r flex flex-col overflow-hidden">
          <div className="shrink-0 px-6 pt-5 pb-3 border-b bg-muted/30">
            <h2 className="text-[28px] font-bold leading-none">📅 This Week</h2>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {events.length === 0 ? (
              <p className="text-xl text-muted-foreground italic mt-2">No events this week</p>
            ) : (() => {
              const groups: { day: string; items: typeof events }[] = []
              for (const ev of events) {
                const day = formatEventDay(ev.start_at, toDateStr(new Date()))
                const last = groups[groups.length - 1]
                if (last?.day === day) last.items.push(ev)
                else groups.push({ day, items: [ev] })
              }
              return groups.map(({ day, items }) => (
                <div key={day}>
                  <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-2">{day}</p>
                  <div className="space-y-2.5">
                    {items.map((ev) => (
                      <div key={ev.id} className="flex items-start gap-4">
                        <div className="mt-2 h-3.5 w-3.5 shrink-0 rounded-full"
                          style={{ backgroundColor: ev.color ?? "#3b82f6" }} />
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

        {/* ── Bottom Right: Messages ─────────────────────────────────────── */}
        <ErrorBoundary label="Messages panel">
        <section className="flex flex-col overflow-hidden">
          <div className="shrink-0 px-6 pt-4 pb-3 border-b bg-muted/30">
            <h2 className="text-[28px] font-bold leading-none">💬 Messages</h2>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {(() => {
              // Group by recipient
              const groups = new Map<string, WallMessage[]>()
              for (const msg of wallMessages) {
                const g = groups.get(msg.to_member_id) ?? []
                g.push(msg)
                groups.set(msg.to_member_id, g)
              }

              if (groups.size === 0) {
                return (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                    <span className="text-4xl">💬</span>
                    <p className="text-xl italic">No messages</p>
                  </div>
                )
              }

              return (
                <div className="flex flex-col gap-3">
                  {Array.from(groups.entries()).map(([toId, msgs]) => {
                    const recipient = memberMap.get(toId)
                    return (
                      <div
                        key={toId}
                        className="flex items-center gap-3 rounded-xl px-4 py-3"
                        style={{
                          backgroundColor: recipient?.color ? `${recipient.color}15` : undefined,
                        }}
                      >
                        <span className="text-3xl leading-none shrink-0">
                          {recipient?.avatar_emoji ?? "👤"}
                        </span>
                        <span
                          className="text-xl font-bold flex-1 min-w-0 truncate"
                          style={{ color: recipient?.color ?? undefined }}
                        >
                          {recipient?.name ?? "Unknown"}
                        </span>
                        <span className="inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-base font-bold min-w-[32px] h-8 px-2 shrink-0">
                          💬 {msgs.length}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </section>
        </ErrorBoundary>

        {/* ── Plants column — spans both rows ────────────────────────────── */}
        <ErrorBoundary label="Plants panel">
        <section className="row-span-2 border-l flex flex-col overflow-hidden">
          <div className="shrink-0 px-4 pt-4 pb-3 border-b bg-muted/30">
            <h2 className="text-xl font-bold leading-none">🌿 Plants</h2>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-4 flex flex-col items-center gap-4">
            {(() => {
              // Match the plants tab: sum of each member's unique plant count
              const familyCount = members.reduce((sum, m) =>
                sum + new Set(wallMemberPlants.filter((wp) => wp.member_id === m.id).map((wp) => wp.plant_id)).size
              , 0)
              const familyMax  = members.length * 30
              const familyGoal = members.length > 0 && members.every((m) =>
                new Set(wallMemberPlants.filter((wp) => wp.member_id === m.id).map((wp) => wp.plant_id)).size >= 30
              )
              const familyPct          = familyMax > 0 ? Math.min(100, Math.round((familyCount / familyMax) * 100)) : 0
              const growingPlantCount  = familyGoal ? 30 : Math.floor((familyPct / 100) * 30)
              return (
                <>
                  {/* Animated growing plant */}
                  <GrowingPlant count={growingPlantCount} size="sm" />

                  {/* Family total */}
                  <div className="text-center">
                    <p className={cn(
                      "text-2xl font-black tabular-nums leading-none",
                      familyGoal ? "text-green-500" : "text-foreground",
                    )}>
                      {familyCount}
                      <span className="text-base font-semibold text-muted-foreground"> / {familyMax}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {familyGoal ? "🌳 Goal reached!" : "family plants"}
                    </p>
                  </div>

                  {/* Per-member counts */}
                  {members.length > 0 && (
                    <div className="w-full flex flex-col gap-2 mt-1">
                      {members.map((m) => {
                        const count = new Set(
                          wallMemberPlants.filter((wp) => wp.member_id === m.id).map((wp) => wp.plant_id)
                        ).size
                        const goal = count >= 30
                        const pct  = Math.min(100, Math.round((count / 30) * 100))
                        return (
                          <div key={m.id} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium truncate">
                                {m.avatar_emoji} {m.name}
                              </span>
                              <span className={cn(
                                "font-bold tabular-nums shrink-0 ml-2",
                                goal ? "text-green-500" : "text-foreground",
                              )}>
                                {count}{goal && " ✨"}
                              </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all",
                                  goal ? "bg-green-500" : "bg-primary",
                                )}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {familyCount === 0 && (
                    <p className="text-sm text-muted-foreground text-center italic mt-2">
                      No plants logged this week
                    </p>
                  )}
                </>
              )
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
