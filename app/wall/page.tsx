"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { X, CheckCircle2, Check, Flame, MessageSquare, RefreshCw, Soup, Cake, CalendarDays, Car, Snowflake, ChefHat } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase"
import { useRealtimeChannel } from "@/lib/use-realtime"
import { ErrorBoundary } from "@/components/error-boundary"
import { GrowingPlant } from "@/app/plants/_growing-plant"
import { MemberAvatar } from "@/components/member-avatar"
import { useAppSettings } from "@/lib/app-settings-context"

// ── Weather ────────────────────────────────────────────────────────────────────

interface WeatherData {
  temp: number
  feelsLike: number
  emoji: string
  description: string
  high: number
  low: number
  rainChance: number
}

function useWeather(lat: number, lon: number) {
  const [weather, setWeather] = useState<WeatherData | null>(null)

  useEffect(() => {
    async function fetch_() {
      try {
        const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`)
        if (res.ok) setWeather(await res.json())
      } catch { /* silent */ }
    }
    fetch_()
    // Refresh every 30 minutes
    const id = setInterval(fetch_, 30 * 60 * 1000)
    return () => clearInterval(id)
  }, [lat, lon])

  return weather
}

// ── Stable realtime config ─────────────────────────────────────────────────────
const WALL_TABLES = [
  { table: "events" },
  { table: "chores" },
  { table: "chore_streaks" },
  { table: "meals" },
  { table: "messages" },
  { table: "birthdays" },
  { table: "member_weekly_plants" },
  { table: "meal_plans" },
] as const

// ── Types ──────────────────────────────────────────────────────────────────────

interface CalEvent {
  id: string
  title: string
  start_at: string
  end_at: string | null
  is_all_day: boolean
  color: string | null
}

interface Member {
  id: string
  name: string
  avatar_emoji: string | null
  avatar_url?: string | null
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
  freezer_item_id?: string | null
}

interface HeadsUp { icon: "car" | "freezer" | "batch"; text: string }

interface WallMessage {
  id: string
  from_member_id: string | null
  to_member_id: string
  body: string
  created_at: string
  dismissed_at: string | null
}

interface BirthdayRow { id: string; name: string; date: string; type: "birthday" | "anniversary"; color: string }
interface WallChoreStreak { member_id: string; streak_count: number; longest_streak: number }
interface WallMemberPlant { plant_id: string; member_id: string; created_at: string }

// ── Helpers ────────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true })
}


// ── Component ──────────────────────────────────────────────────────────────────

export default function WallPage() {
  const router = useRouter()
  const supabase = useRef(createClient()).current
  const { settings } = useAppSettings()

  const weather = useWeather(
    settings?.weatherLat ?? 1.3521,
    settings?.weatherLon ?? 103.8198,
  )

  const [now, setNow] = useState<Date>(() => new Date())

  // Data
  const [events, setEvents]                       = useState<CalEvent[]>([])
  const [birthdays, setBirthdays]                 = useState<BirthdayRow[]>([])
  const [members, setMembers]                     = useState<Member[]>([])
  const [choresToday, setChoresToday]             = useState<Chore[]>([])
  const [choresTomorrow, setChoresTomorrow]       = useState<Chore[]>([])
  const [dinnerToday, setDinnerToday]             = useState<Meal | null>(null)
  const [lunchboxesToday, setLunchboxesToday]     = useState<Meal[]>([])
  const [dinnerTomorrow, setDinnerTomorrow]       = useState<Meal | null>(null)
  const [lunchboxesTomorrow, setLunchboxesTomorrow] = useState<Meal[]>([])
  const [wallMessages, setWallMessages]           = useState<WallMessage[]>([])
  const [choreStreaks, setChoreStreaks]            = useState<Map<string, WallChoreStreak>>(new Map())
  const [wallMemberPlants, setWallMemberPlants]   = useState<WallMemberPlant[]>([])
  const [carDinnerToday, setCarDinnerToday]       = useState<Meal | null>(null)
  const [defrostTonight, setDefrostTonight]       = useState<Meal[]>([])
  const [batchToday, setBatchToday]               = useState<string[]>([])

  // Clock
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const tomorrow   = addDays(today, 1)
    const weekEnd    = addDays(today, 7)
    const todayStr   = toDateStr(today)
    const tomorrowStr = toDateStr(tomorrow)

    const weekMonday = new Date(today)
    weekMonday.setDate(weekMonday.getDate() - (weekMonday.getDay() + 6) % 7)
    const p2 = (n: number) => String(n).padStart(2, "0")
    const weekMondayStr = `${weekMonday.getFullYear()}-${p2(weekMonday.getMonth()+1)}-${p2(weekMonday.getDate())}`

    const [evRes, memRes, ctRes, cmRes, mealRes, msgRes, bdRes, strRes, wpRes, planRes] = await Promise.all([
      // Look back 30 days so multi-day events that started before today are included,
      // then filter in JS to events that still overlap with the current week.
      supabase.from("events").select("id,title,start_at,end_at,is_all_day,color")
        .gte("start_at", addDays(today, -30).toISOString())
        .lt("start_at", weekEnd.toISOString())
        .order("start_at"),
      supabase.from("family_members").select("*").order("created_at"),
      supabase.from("chores").select("id,title,assigned_to,completed,completed_at,pocket_money_value").eq("due_date", todayStr),
      supabase.from("chores").select("id,title,assigned_to,completed,completed_at,pocket_money_value").eq("due_date", tomorrowStr),
      supabase.from("meals").select("id,title,meal_type,date,notes,for_member_id,freezer_item_id").in("date", [todayStr, tomorrowStr]),
      supabase.from("messages").select("id,from_member_id,to_member_id,body,created_at,dismissed_at")
        .is("dismissed_at", null).order("created_at", { ascending: false }),
      supabase.from("birthdays").select("id,name,date,type,color"),
      supabase.from("chore_streaks").select("member_id,streak_count,longest_streak"),
      supabase.from("member_weekly_plants").select("plant_id,member_id,created_at").eq("week_start", weekMondayStr),
      supabase.from("meal_plans").select("plan").eq("week_start", weekMondayStr).maybeSingle(),
    ])

    // Keep only events that end on or after today (catches multi-day events in progress)
    const allEvents = (evRes.data ?? []) as CalEvent[]
    setEvents(allEvents.filter(ev => {
      const evEnd = ev.end_at ? new Date(ev.end_at) : new Date(ev.start_at)
      return evEnd >= today
    }))
    setBirthdays(bdRes.data ?? [])
    setMembers(memRes.data ?? [])
    setChoresToday(ctRes.data ?? [])
    setChoresTomorrow(cmRes.data ?? [])
    setWallMessages(msgRes.data ?? [])
    setWallMemberPlants((wpRes.data ?? []) as WallMemberPlant[])

    const sm = new Map<string, WallChoreStreak>()
    for (const r of (strRes.data ?? []) as WallChoreStreak[]) sm.set(r.member_id, r)
    setChoreStreaks(sm)

    const meals = mealRes.data ?? []
    setDinnerToday(meals.find(m => m.date === todayStr   && m.meal_type === "dinner") ?? null)
    setDinnerTomorrow(meals.find(m => m.date === tomorrowStr && m.meal_type === "dinner") ?? null)
    setLunchboxesToday(meals.filter(m => m.date === todayStr   && m.meal_type === "lunchbox"))
    setLunchboxesTomorrow(meals.filter(m => m.date === tomorrowStr && m.meal_type === "lunchbox"))
    setCarDinnerToday(meals.find(m => m.date === todayStr && m.meal_type === "car_dinner") ?? null)
    // One reminder per freezer dish (lunchbox rows repeat per child)
    const frozen = meals.filter(m => m.date === tomorrowStr && m.freezer_item_id)
    setDefrostTonight(frozen.filter((m, i) => frozen.findIndex(x => x.freezer_item_id === m.freezer_item_id) === i))

    // Batch cook session today (from this week's meal plan, if any)
    const batch = (planRes.data as { plan?: { batch_session?: { date: string; done?: boolean; dishes: { title: string }[] } | null } } | null)?.plan?.batch_session
    setBatchToday(batch && batch.date === todayStr && !batch.done ? batch.dishes.map(d => d.title) : [])
  }, [supabase])

  useEffect(() => {
    // Trigger a background Google Calendar sync so the wall always shows fresh events
    fetch("/api/google-calendar/sync").catch(() => {/* ignore — wall still shows DB data */})
    fetchAll()
    const id = setInterval(fetchAll, 60_000)
    return () => clearInterval(id)
  }, [fetchAll])

  useRealtimeChannel(supabase, "wall-realtime", WALL_TABLES, fetchAll)

  // ── Toggle today chore ─────────────────────────────────────────────────────

  async function toggleChore(chore: Chore) {
    const completed = !chore.completed
    setChoresToday(prev => prev.map(c => c.id === chore.id ? { ...c, completed } : c))
    const { error } = await supabase.from("chores")
      .update({ completed, completed_at: completed ? new Date().toISOString() : null })
      .eq("id", chore.id)
    if (error) {
      setChoresToday(prev => prev.map(c => c.id === chore.id ? chore : c))
      toast.error("Couldn't update task.")
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const memberMap = useMemo(() => new Map(members.map(m => [m.id, m])), [members])
  const todayStr  = toDateStr(new Date())

  // Birthdays within this week — include occurrence Date for sorting
  const upcomingBirthdays = useMemo(() => {
    const todayMs = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime() })()
    return birthdays.map(b => {
      const [, mo, dy] = b.date.split("-").map(Number)
      let occ = new Date(new Date().getFullYear(), mo - 1, dy)
      if (occ.getTime() < todayMs) occ = new Date(new Date().getFullYear() + 1, mo - 1, dy)
      return { ...b, daysAway: Math.round((occ.getTime() - todayMs) / 86_400_000), occ }
    }).filter(b => b.daysAway <= 7).sort((a, b) => a.daysAway - b.daysAway)
  }, [birthdays])

  // Plant counts — confirmed only (logged before today); pending shown as suffix
  const confirmedWallPlants = wallMemberPlants.filter(wp => toDateStr(new Date(wp.created_at)) < todayStr)
  const pendingWallPlants   = wallMemberPlants.filter(wp => toDateStr(new Date(wp.created_at)) === todayStr)

  const familyCount = members.reduce((sum, m) =>
    sum + new Set(confirmedWallPlants.filter(wp => wp.member_id === m.id).map(wp => wp.plant_id)).size
  , 0)
  const familyMax  = members.length * 30
  const familyGoal = members.length > 0 && members.every(m =>
    new Set(confirmedWallPlants.filter(wp => wp.member_id === m.id).map(wp => wp.plant_id)).size >= 30
  )
  const familyPct         = familyMax > 0 ? Math.min(100, Math.round((familyCount / familyMax) * 100)) : 0
  const growingPlantCount = familyGoal ? 30 : Math.floor((familyPct / 100) * 30)
  const familyPendingCount = members.reduce((sum, m) =>
    sum + new Set(pendingWallPlants.filter(wp => wp.member_id === m.id).map(wp => wp.plant_id)).size
  , 0)

  // Members with unread messages
  const msgMemberNames = useMemo(() => {
    const seen = new Set<string>()
    const ids: string[] = []
    for (const m of wallMessages) {
      if (!seen.has(m.to_member_id)) { seen.add(m.to_member_id); ids.push(m.to_member_id) }
    }
    return ids.map(id => memberMap.get(id)?.name).filter(Boolean) as string[]
  }, [wallMessages, memberMap])

  // Clock display
  const hh = String(now.getHours()).padStart(2, "0")
  const mm = String(now.getMinutes()).padStart(2, "0")
  const dateLabel = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })

  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening"
  const familyName = settings?.familyName ?? "Family Hub"
  const doneToday = choresToday.filter(c => c.completed).length

  const memberPlantCounts = members.map(m => ({
    member: m,
    count: new Set(confirmedWallPlants.filter(wp => wp.member_id === m.id).map(wp => wp.plant_id)).size,
  }))

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-background text-foreground flex flex-col gap-5 overflow-hidden select-none px-8 pt-7 pb-8">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="shrink-0 flex items-end justify-between gap-6">
        <div className="min-w-0">
          <p className="text-[17px] font-medium text-muted-foreground">{dateLabel}</p>
          <h1 className="font-display text-[42px] font-semibold leading-tight tracking-tight truncate">
            {greeting}
            <span className="text-muted-foreground font-medium">, {familyName}</span>
          </h1>
        </div>

        <div className="flex items-center gap-5 shrink-0">
          {weather && (
            <div className="flex items-center gap-3 rounded-2xl bg-card border border-border px-4 py-2.5">
              <span className="text-[28px] leading-none" aria-hidden="true">{weather.emoji}</span>
              <div className="leading-tight">
                <p className="font-display text-[24px] font-semibold tabular-nums leading-none">{weather.temp}°</p>
                <p className="text-[12px] text-muted-foreground mt-1 tabular-nums">
                  {weather.high}° / {weather.low}°
                  {weather.rainChance > 20 && <span className="ml-1.5">Rain {weather.rainChance}%</span>}
                </p>
              </div>
            </div>
          )}

          {members.length > 0 && (
            <div className="flex -space-x-2" aria-label="Family members">
              {members.map(m => (
                <Avatar key={m.id} member={m} className="size-11 text-[18px] ring-[3px] ring-background" />
              ))}
            </div>
          )}

          <p className="font-display text-[64px] font-medium leading-none tracking-tight tabular-nums">
            {hh}:{mm}
          </p>

          <button
            onClick={() => router.back()}
            aria-label="Exit wall display"
            className="flex items-center justify-center size-11 rounded-full border border-border bg-card text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>
      </header>

      {/* ── 3-column body ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 grid gap-5" style={{ gridTemplateColumns: "1.15fr 1fr 0.95fr" }}>

        {/* ════════════════ COL 1: MEALS + PLANTS ════════════════ */}
        <ErrorBoundary label="Meals">
          <div className="flex flex-col gap-5 min-h-0">
            <DinnerHero dinner={dinnerToday} headsUp={[
              ...(carDinnerToday ? [{ icon: "car" as const, text: `Car dinner${carDinnerToday.for_member_id && memberMap.get(carDinnerToday.for_member_id) ? ` for ${memberMap.get(carDinnerToday.for_member_id)!.name}` : ""}: ${carDinnerToday.title}` }] : []),
              ...defrostTonight.map(m => ({ icon: "freezer" as const, text: `Defrost tonight: ${m.title} for tomorrow` })),
              ...(batchToday.length ? [{ icon: "batch" as const, text: `Batch cook today: ${batchToday.join(", ")}` }] : []),
            ]} />

            <Card className="px-7 py-5">
              <Kicker>Lunchboxes today</Kicker>
              <Lunchboxes lunchboxes={lunchboxesToday} memberMap={memberMap} large />
            </Card>

            <Card className="px-7 py-5">
              <Kicker>Tomorrow</Kicker>
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="min-w-0">
                  <p className="text-[14px] text-muted-foreground">Dinner</p>
                  <p className={cn("text-[19px] font-semibold truncate", !dinnerTomorrow && "text-muted-foreground font-medium")}>
                    {dinnerTomorrow?.title ?? "Not planned"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] text-muted-foreground">Lunchboxes</p>
                  <Lunchboxes lunchboxes={lunchboxesTomorrow} memberMap={memberMap} />
                </div>
              </div>
            </Card>

            <PlantsCard
              memberPlantCounts={memberPlantCounts}
              familyCount={familyCount}
              familyMax={familyMax}
              familyGoal={familyGoal}
              growingPlantCount={growingPlantCount}
              pendingCount={familyPendingCount}
            />
          </div>
        </ErrorBoundary>

        {/* ════════════════ COL 2: TASKS ════════════════ */}
        <ErrorBoundary label="Tasks">
          <Card className="flex flex-col min-h-0 p-7 gap-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-[28px] font-semibold">Today&apos;s jobs</h2>
              {choresToday.length > 0 && (
                <p className="text-[15px] font-semibold text-muted-foreground tabular-nums">
                  {doneToday} of {choresToday.length} done
                </p>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-hidden">
              <TasksToday
                chores={choresToday}
                memberMap={memberMap}
                choreStreaks={choreStreaks}
                onToggle={toggleChore}
              />
            </div>

            {choresTomorrow.length > 0 && (
              <div className="shrink-0 border-t border-border pt-4">
                <Kicker>Tomorrow</Kicker>
                <TasksTomorrow chores={choresTomorrow} memberMap={memberMap} />
              </div>
            )}

            {msgMemberNames.length > 0 && (
              <div className="shrink-0 flex items-center gap-3 rounded-2xl bg-accent text-accent-foreground px-4 py-3">
                <MessageSquare className="size-5 shrink-0" />
                <p className="text-[15px] leading-snug">
                  <span className="font-semibold">{msgMemberNames.join(", ")}</span>
                  {" "}{msgMemberNames.length === 1 ? "has" : "have"} new messages
                </p>
              </div>
            )}
          </Card>
        </ErrorBoundary>

        {/* ════════════════ COL 3: THIS WEEK ════════════════ */}
        <ErrorBoundary label="Calendar">
          <Card className="flex flex-col min-h-0 p-7 gap-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-[28px] font-semibold">This week</h2>
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
                <RefreshCw className="size-3.5" />
                Google Calendar
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <CalendarSection events={events} upcomingBirthdays={upcomingBirthdays} todayStr={todayStr} />
            </div>
          </Card>
        </ErrorBoundary>

      </div>
    </div>
  )
}

// ── Building blocks ────────────────────────────────────────────────────────────

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-[28px] bg-card border border-border", className)}>
      {children}
    </section>
  )
}

function Kicker({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("text-[13px] font-semibold uppercase tracking-[0.08em] text-muted-foreground", className)}>
      {children}
    </p>
  )
}

function Avatar({ member, className }: { member: Member | null | undefined; className?: string }) {
  return <MemberAvatar member={member} className={className} />
}

// ── Meals ──────────────────────────────────────────────────────────────────────

function DinnerHero({ dinner, headsUp = [] }: { dinner: Meal | null; headsUp?: HeadsUp[] }) {
  return (
    <section className="rounded-[28px] bg-primary text-primary-foreground px-7 py-6 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] opacity-80">Tonight&apos;s dinner</p>
        <Soup className="size-6 opacity-80" />
      </div>
      {dinner ? (
        <>
          <h2 className="font-display text-[38px] font-semibold leading-[1.05] tracking-tight line-clamp-2">
            {dinner.title}
          </h2>
          {dinner.notes && (
            <span className="self-start rounded-full bg-white/15 px-3 py-1.5 text-[14px] font-medium truncate max-w-full">
              {dinner.notes}
            </span>
          )}
        </>
      ) : (
        <h2 className="font-display text-[30px] font-semibold leading-tight opacity-80">Nothing planned yet</h2>
      )}
      {headsUp.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-white/20 pt-3 mt-1">
          {headsUp.map((h, i) => {
            const Icon = h.icon === "car" ? Car : h.icon === "freezer" ? Snowflake : ChefHat
            return (
              <p key={i} className="flex items-center gap-2 text-[16px] font-medium leading-snug">
                <Icon className="size-4 shrink-0 opacity-80" />
                <span className="truncate">{h.text}</span>
              </p>
            )
          })}
        </div>
      )}
    </section>
  )
}

function Lunchboxes({
  lunchboxes, memberMap, large = false,
}: {
  lunchboxes: Meal[]
  memberMap: Map<string, Member>
  large?: boolean
}) {
  if (lunchboxes.length === 0) {
    return (
      <p className={cn("text-muted-foreground font-medium", large ? "text-[19px] mt-1.5" : "text-[19px]")}>
        Not planned
      </p>
    )
  }
  return (
    <div className={cn("flex flex-col", large ? "gap-2.5 mt-2.5" : "gap-1")}>
      {lunchboxes.map(lunch => {
        const child = lunch.for_member_id ? memberMap.get(lunch.for_member_id) : null
        return (
          <div key={lunch.id} className="flex items-center gap-2.5 min-w-0">
            {child && <Avatar member={child} className={large ? "size-8 text-[15px]" : "size-6 text-[12px]"} />}
            <p className={cn("font-semibold truncate", large ? "text-[21px]" : "text-[16px]")}>{lunch.title}</p>
          </div>
        )
      })}
    </div>
  )
}

// ── Tasks ──────────────────────────────────────────────────────────────────────

const MAX_TASKS = 8

function TasksToday({
  chores, memberMap, choreStreaks, onToggle,
}: {
  chores: Chore[]
  memberMap: Map<string, Member>
  choreStreaks: Map<string, WallChoreStreak>
  onToggle: (c: Chore) => void
}) {
  if (chores.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 rounded-2xl bg-accent/60 text-accent-foreground">
        <CheckCircle2 className="size-8" />
        <p className="text-[18px] font-semibold">No jobs today</p>
      </div>
    )
  }

  const overflow = chores.length > MAX_TASKS ? chores.length - (MAX_TASKS - 1) : 0
  const shown    = overflow > 0 ? chores.slice(0, MAX_TASKS - 1) : chores

  const groupMap = new Map<string, Chore[]>()
  for (const c of shown) {
    const key = c.assigned_to ?? "__none__"
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(c)
  }

  return (
    <div className="flex flex-col gap-5">
      {Array.from(groupMap.entries()).map(([key, items]) => {
        const member = key === "__none__" ? null : (memberMap.get(key) ?? null)
        const streak = member ? choreStreaks.get(member.id) : null
        const earned = items.filter(c => c.completed).reduce((s, c) => s + (c.pocket_money_value ?? 0), 0)
        return (
          <div key={key} className="flex flex-col gap-2">
            <div className="flex items-center gap-2.5">
              <Avatar member={member} className="size-8 text-[15px]" />
              <span className="text-[17px] font-semibold">{member?.name ?? "Anyone"}</span>
              {streak && streak.streak_count > 1 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[13px] font-semibold tabular-nums">
                  <Flame className="size-3.5 text-[#C2552F]" />
                  {streak.streak_count}
                </span>
              )}
              {earned > 0 && (
                <span className="ml-auto rounded-full bg-[#FBEBD9] dark:bg-[#3A2A1A] px-2.5 py-1 text-[13px] font-semibold text-[#8A4B12] dark:text-[#F0C08A] tabular-nums">
                  S${earned.toFixed(2)} earned
                </span>
              )}
            </div>

            {items.map(chore => (
              <button
                key={chore.id}
                onClick={() => onToggle(chore)}
                aria-pressed={chore.completed}
                className={cn(
                  "flex items-center gap-3.5 w-full min-h-[54px] px-3.5 rounded-2xl border text-left transition-colors active:scale-[0.99]",
                  chore.completed
                    ? "bg-accent/70 border-accent"
                    : "bg-background/40 border-border hover:bg-secondary/60",
                )}
              >
                <span className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  chore.completed ? "bg-primary border-primary text-primary-foreground" : "border-input",
                )}>
                  {chore.completed && <Check className="size-4" strokeWidth={3} />}
                </span>
                <span className={cn(
                  "flex-1 truncate text-[17px] font-medium",
                  chore.completed && "line-through text-muted-foreground",
                )}>
                  {chore.title}
                </span>
                {chore.pocket_money_value > 0 && (
                  <span className="shrink-0 text-[14px] font-semibold text-[#8A4B12] dark:text-[#F0C08A] tabular-nums">
                    S${chore.pocket_money_value.toFixed(2)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )
      })}
      {overflow > 0 && <p className="text-[14px] font-medium text-muted-foreground">+{overflow} more</p>}
    </div>
  )
}

function TasksTomorrow({ chores, memberMap }: { chores: Chore[]; memberMap: Map<string, Member> }) {
  const shown = chores.slice(0, 4)
  const more  = chores.length - shown.length
  return (
    <div className="flex flex-wrap gap-2 mt-2.5">
      {shown.map(chore => {
        const member = chore.assigned_to ? memberMap.get(chore.assigned_to) : null
        return (
          <span key={chore.id} className="inline-flex items-center gap-2 rounded-full bg-secondary pl-1 pr-3 py-1 max-w-full">
            <Avatar member={member} className="size-6 text-[12px]" />
            <span className="text-[14px] font-medium truncate">{chore.title}</span>
          </span>
        )
      })}
      {more > 0 && <span className="text-[14px] font-medium text-muted-foreground self-center">+{more} more</span>}
    </div>
  )
}

// ── Calendar ───────────────────────────────────────────────────────────────────

const MAX_EVENTS = 7

interface CalItem {
  id: string
  title: string
  date: Date
  time: string | null
  color: string
  isToday: boolean
  isBirthday: boolean
  sortMs: number
}

function CalendarSection({
  events, upcomingBirthdays, todayStr,
}: {
  events: CalEvent[]
  upcomingBirthdays: Array<{ id: string; name: string; type: "birthday" | "anniversary"; color: string; daysAway: number; occ: Date }>
  todayStr: string
}) {
  const items: CalItem[] = []

  for (const ev of events) {
    const d = new Date(ev.start_at)
    items.push({
      id: ev.id,
      title: ev.title,
      date: d,
      time: ev.is_all_day ? "All day" : ev.end_at
        ? `${fmtTime(ev.start_at)} to ${fmtTime(ev.end_at)}`
        : fmtTime(ev.start_at),
      color: ev.color ?? "#3D6B57",
      isToday: toDateStr(d) === todayStr,
      isBirthday: false,
      sortMs: d.getTime(),
    })
  }

  for (const b of upcomingBirthdays) {
    items.push({
      id: `bd-${b.id}`,
      title: b.name,
      date: b.occ,
      time: b.type === "birthday" ? "Birthday" : "Anniversary",
      color: b.color || "#A3456B",
      isToday: b.daysAway === 0,
      isBirthday: true,
      sortMs: b.occ.getTime(),
    })
  }

  items.sort((a, b) => a.sortMs - b.sortMs)

  if (items.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 rounded-2xl bg-secondary/60 text-muted-foreground">
        <CalendarDays className="size-8" />
        <p className="text-[17px] font-medium">A quiet week</p>
      </div>
    )
  }

  const overflow = items.length > MAX_EVENTS ? items.length - MAX_EVENTS : 0
  const shown    = overflow > 0 ? items.slice(0, MAX_EVENTS) : items

  return (
    <div className="flex flex-col gap-3.5">
      {shown.map(item => (
        <div key={item.id} className="flex items-stretch gap-3.5">
          <div className={cn(
            "flex w-[54px] shrink-0 flex-col items-center justify-center rounded-2xl py-2",
            item.isToday ? "bg-foreground text-background" : "bg-secondary text-foreground",
          )}>
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em]">
              {item.date.toLocaleDateString("en-GB", { weekday: "short" })}
            </span>
            <span className="font-display text-[22px] font-semibold leading-tight">{item.date.getDate()}</span>
          </div>
          <div className="min-w-0 flex-1 flex flex-col justify-center gap-1">
            <p className="flex items-center gap-1.5 text-[17px] font-semibold leading-snug">
              {item.isBirthday && <Cake className="size-4 shrink-0" style={{ color: item.color }} />}
              <span className="truncate">{item.title}</span>
            </p>
            <p className="flex items-center gap-2 text-[14px] text-muted-foreground">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
              {item.time}
            </p>
          </div>
        </div>
      ))}
      {overflow > 0 && <p className="text-[14px] font-medium text-muted-foreground">+{overflow} more this week</p>}
    </div>
  )
}

// ── Plants ─────────────────────────────────────────────────────────────────────

function PlantsCard({
  memberPlantCounts, familyCount, familyMax, familyGoal, growingPlantCount, pendingCount,
}: {
  memberPlantCounts: Array<{ member: Member; count: number }>
  familyCount: number
  familyMax: number
  familyGoal: boolean
  growingPlantCount: number
  pendingCount: number
}) {
  const pct = familyMax > 0 ? Math.min(100, Math.round((familyCount / familyMax) * 100)) : 0
  return (
    <section className="flex-1 min-h-0 rounded-[28px] bg-accent text-accent-foreground px-7 py-5 flex gap-4 overflow-hidden">
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <Kicker className="text-accent-foreground/80">Plants this week</Kicker>
          <p className="text-[15px] font-semibold tabular-nums">
            {familyCount} of {familyMax}
            {pendingCount > 0 && <span className="font-medium opacity-70"> (+{pendingCount} today)</span>}
          </p>
        </div>
        <div className="h-3 rounded-full bg-primary/15 overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", familyGoal ? "bg-[#3D8B5F]" : "bg-primary")}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(1, memberPlantCounts.length)}, minmax(0, 1fr))` }}>
          {memberPlantCounts.map(({ member, count }) => {
            const color = member.color ?? "#3D6B57"
            return (
              <div key={member.id} className="flex flex-col gap-1.5 min-w-0">
                <div className="flex items-center gap-2">
                  <Avatar member={member} className="size-7 text-[13px]" />
                  <span className="text-[20px] font-semibold tabular-nums text-foreground">{count}</span>
                </div>
                <div className="h-1.5 rounded-full bg-primary/15 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, (count / 30) * 100)}%`, backgroundColor: color }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="shrink-0 self-center">
        <GrowingPlant count={growingPlantCount} size="sm" />
      </div>
    </section>
  )
}
