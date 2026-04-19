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
import { useAppSettings } from "@/lib/app-settings-context"

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

// ── Types ──────────────────────────────────────────────────────────────────────

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

interface BirthdayRow { id: string; name: string; date: string; type: "birthday" | "anniversary"; color: string }
interface WallChoreStreak { member_id: string; streak_count: number; longest_streak: number }
interface WallMemberPlant { plant_id: string; member_id: string }

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

function dayChip(d: Date, todayStr: string): string {
  const s = toDateStr(d)
  if (s === todayStr) return "Today"
  const wd = d.toLocaleDateString("en-AU", { weekday: "short" })
  return `${wd} ${d.getDate()}`
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function WallPage() {
  const router = useRouter()
  const supabase = useRef(createClient()).current
  const { settings } = useAppSettings()

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

    const [evRes, memRes, ctRes, cmRes, mealRes, msgRes, bdRes, strRes, wpRes] = await Promise.all([
      supabase.from("events").select("id,title,start_at,end_at,color")
        .gte("start_at", today.toISOString()).lt("start_at", weekEnd.toISOString()).order("start_at"),
      supabase.from("family_members").select("id,name,avatar_emoji,color").order("created_at"),
      supabase.from("chores").select("id,title,assigned_to,completed,completed_at,pocket_money_value").eq("due_date", todayStr),
      supabase.from("chores").select("id,title,assigned_to,completed,completed_at,pocket_money_value").eq("due_date", tomorrowStr),
      supabase.from("meals").select("id,title,meal_type,date,notes,for_member_id").in("date", [todayStr, tomorrowStr]),
      supabase.from("messages").select("id,from_member_id,to_member_id,body,created_at,dismissed_at")
        .is("dismissed_at", null).order("created_at", { ascending: false }),
      supabase.from("birthdays").select("id,name,date,type,color"),
      supabase.from("chore_streaks").select("member_id,streak_count,longest_streak"),
      supabase.from("member_weekly_plants").select("plant_id,member_id").eq("week_start", weekMondayStr),
    ])

    setEvents(evRes.data ?? [])
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
  }, [supabase])

  useEffect(() => {
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

  // Plant counts
  const familyCount = members.reduce((sum, m) =>
    sum + new Set(wallMemberPlants.filter(wp => wp.member_id === m.id).map(wp => wp.plant_id)).size
  , 0)
  const familyMax  = members.length * 30
  const familyGoal = members.length > 0 && members.every(m =>
    new Set(wallMemberPlants.filter(wp => wp.member_id === m.id).map(wp => wp.plant_id)).size >= 30
  )
  const familyPct         = familyMax > 0 ? Math.min(100, Math.round((familyCount / familyMax) * 100)) : 0
  const growingPlantCount = familyGoal ? 30 : Math.floor((familyPct / 100) * 30)

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
  const dateLabel = now.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-background text-foreground flex flex-col overflow-hidden select-none">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="shrink-0 h-[60px] border-b bg-background flex items-center px-4 gap-3">
        {/* Time */}
        <span className="text-[30px] font-bold tabular-nums leading-none w-[100px] shrink-0">
          {hh}:{mm}
        </span>

        {/* Family name — centre */}
        <div className="flex-1 text-center">
          <span className="text-lg font-semibold tracking-wide">
            {settings?.familyName ?? "Family Hub"}
          </span>
        </div>

        {/* Date + Exit */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-sm text-muted-foreground">{dateLabel}</span>
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
            Exit
          </button>
        </div>
      </header>

      {/* ── 3-column body ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 grid overflow-hidden" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>

        {/* ════════════════ COL 1: MEALS ════════════════ */}
        <ErrorBoundary label="Meals">
        <div className="flex flex-col border-r border-border overflow-hidden">

          {/* Today */}
          <div className="flex-1 flex flex-col overflow-hidden border-b border-border">
            <SectionHeading>Today</SectionHeading>
            <div className="flex-1 overflow-hidden px-4 py-3">
              <MealSection dinner={dinnerToday} lunchboxes={lunchboxesToday} memberMap={memberMap} />
            </div>
          </div>

          {/* Tomorrow */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <SectionHeading>Tomorrow</SectionHeading>
            <div className="flex-1 overflow-hidden px-4 py-3">
              <MealSection dinner={dinnerTomorrow} lunchboxes={lunchboxesTomorrow} memberMap={memberMap} />
            </div>
          </div>

        </div>
        </ErrorBoundary>

        {/* ════════════════ COL 2: TASKS ════════════════ */}
        <ErrorBoundary label="Tasks">
        <div className="flex flex-col border-r border-border overflow-hidden">

          {/* Today's tasks */}
          <div className="flex-1 flex flex-col overflow-hidden border-b border-border">
            <SectionHeading>Today&apos;s Tasks</SectionHeading>
            <div className="flex-1 overflow-hidden px-4 py-3">
              <TasksList
                chores={choresToday}
                memberMap={memberMap}
                choreStreaks={choreStreaks}
                interactive
                onToggle={toggleChore}
              />
            </div>
          </div>

          {/* Tomorrow's tasks + messages bar */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <SectionHeading>Tomorrow&apos;s Tasks</SectionHeading>
            <div className="flex-1 overflow-hidden px-4 py-3">
              <TasksList
                chores={choresTomorrow}
                memberMap={memberMap}
                interactive={false}
              />
            </div>
            {msgMemberNames.length > 0 && (
              <div className="shrink-0 border-t border-border bg-primary/5 px-4 py-2">
                <p className="text-[13px] text-muted-foreground leading-snug">
                  <span className="mr-1">💬</span>
                  <span className="font-semibold text-foreground">{msgMemberNames.join(", ")}</span>
                  {" "}{msgMemberNames.length === 1 ? "has" : "have"} messages
                </p>
              </div>
            )}
          </div>

        </div>
        </ErrorBoundary>

        {/* ════════════════ COL 3: CALENDAR + PLANTS ════════════════ */}
        <ErrorBoundary label="Calendar & Plants">
        <div className="flex flex-col overflow-hidden">

          {/* Calendar — 60% */}
          <div className="flex flex-col overflow-hidden border-b border-border" style={{ flex: "3" }}>
            <SectionHeading>This Week</SectionHeading>
            <div className="flex-1 overflow-hidden px-4 py-3">
              <CalendarSection
                events={events}
                upcomingBirthdays={upcomingBirthdays}
                todayStr={todayStr}
              />
            </div>
          </div>

          {/* Plants — 40% */}
          <div className="flex flex-col overflow-hidden" style={{ flex: "2" }}>
            <SectionHeading>🌿 Plants</SectionHeading>
            <div className="flex-1 overflow-hidden px-4 py-2">
              <PlantsSection
                members={members}
                wallMemberPlants={wallMemberPlants}
                familyCount={familyCount}
                familyMax={familyMax}
                familyGoal={familyGoal}
                growingPlantCount={growingPlantCount}
              />
            </div>
          </div>

        </div>
        </ErrorBoundary>

      </div>
    </div>
  )
}

// ── SectionHeading ─────────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="shrink-0 px-4 py-2 bg-muted/25 border-b border-border">
      <h2 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground leading-none">
        {children}
      </h2>
    </div>
  )
}

// ── MealSection ────────────────────────────────────────────────────────────────

function MealSection({
  dinner, lunchboxes, memberMap,
}: {
  dinner: Meal | null
  lunchboxes: Meal[]
  memberMap: Map<string, Member>
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Dinner */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
          🍽️ Dinner
        </p>
        {dinner ? (
          <>
            <p className="text-[20px] font-bold leading-tight truncate">{dinner.title}</p>
            {dinner.notes && (
              <p className="text-[13px] text-muted-foreground truncate mt-0.5">{dinner.notes}</p>
            )}
          </>
        ) : (
          <p className="text-[15px] text-muted-foreground italic">Nothing planned</p>
        )}
      </div>

      {/* Lunchboxes */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
          🥪 Lunchboxes
        </p>
        {lunchboxes.length > 0 ? (
          <div className="flex flex-col gap-2">
            {lunchboxes.map(lunch => {
              const child = lunch.for_member_id ? memberMap.get(lunch.for_member_id) : null
              return (
                <div key={lunch.id} className="flex items-center gap-2">
                  {child?.avatar_emoji && (
                    <span className="text-[18px] leading-none shrink-0">{child.avatar_emoji}</span>
                  )}
                  <div className="min-w-0">
                    {child && (
                      <p className="text-[11px] font-bold uppercase tracking-wide truncate"
                        style={{ color: child.color ?? undefined }}>
                        {child.name}
                      </p>
                    )}
                    <p className="text-[15px] font-semibold leading-snug truncate">{lunch.title}</p>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-[15px] text-muted-foreground italic">Nothing planned</p>
        )}
      </div>
    </div>
  )
}

// ── TasksList ──────────────────────────────────────────────────────────────────

const MAX_TASKS = 6

function TasksList({
  chores, memberMap, choreStreaks, interactive = false, onToggle,
}: {
  chores: Chore[]
  memberMap: Map<string, Member>
  choreStreaks?: Map<string, WallChoreStreak>
  interactive?: boolean
  onToggle?: (c: Chore) => void
}) {
  if (chores.length === 0) {
    return (
      <p className="text-[15px] text-muted-foreground italic">
        {interactive ? "No tasks today 🎉" : "Nothing due tomorrow"}
      </p>
    )
  }

  const total    = chores.length
  const overflow = total > MAX_TASKS ? total - (MAX_TASKS - 1) : 0
  const shown    = overflow > 0 ? chores.slice(0, MAX_TASKS - 1) : chores

  if (!interactive) {
    // Flat list: avatar + task name only
    return (
      <div className="flex flex-col gap-1.5">
        {shown.map(chore => {
          const member = chore.assigned_to ? memberMap.get(chore.assigned_to) : null
          return (
            <div key={chore.id} className="flex items-center gap-2">
              {member?.avatar_emoji && (
                <span className="text-[16px] leading-none shrink-0">{member.avatar_emoji}</span>
              )}
              <span className="text-[15px] leading-snug truncate flex-1">{chore.title}</span>
            </div>
          )
        })}
        {overflow > 0 && (
          <p className="text-[13px] text-muted-foreground italic">+{overflow} more</p>
        )}
      </div>
    )
  }

  // Grouped interactive view
  const groupMap = new Map<string, Chore[]>()
  for (const c of shown) {
    const key = c.assigned_to ?? "__none__"
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(c)
  }

  return (
    <div className="flex flex-col gap-3">
      {Array.from(groupMap.entries()).map(([key, items]) => {
        const member = key === "__none__" ? null : (memberMap.get(key) ?? null)
        const streak = member ? choreStreaks?.get(member.id) : null
        return (
          <div key={key}>
            {/* Member sub-heading */}
            <div className="flex items-center gap-1.5 mb-1">
              {member?.avatar_emoji && (
                <span className="text-[18px] leading-none">{member.avatar_emoji}</span>
              )}
              <span
                className="text-[15px] font-bold leading-none"
                style={member?.color ? { color: member.color } : undefined}
              >
                {member?.name ?? "Unassigned"}
              </span>
              {streak && streak.streak_count > 0 && (
                <span className={cn(
                  "text-[13px] font-bold tabular-nums",
                  streak.streak_count >= 7 ? "text-orange-500" : "text-amber-500",
                )}>
                  🔥{streak.streak_count}
                </span>
              )}
            </div>

            {/* Task rows */}
            <div className="flex flex-col gap-1 pl-1">
              {items.map(chore => (
                <button
                  key={chore.id}
                  onClick={() => onToggle?.(chore)}
                  className="flex items-center gap-2 w-full text-left group cursor-pointer"
                >
                  {chore.completed ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
                  ) : (
                    <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40 group-hover:text-foreground transition-colors" />
                  )}
                  <span className={cn(
                    "text-[15px] leading-snug flex-1 truncate",
                    chore.completed && "line-through text-muted-foreground",
                  )}>
                    {chore.title}
                  </span>
                  {chore.pocket_money_value > 0 && (
                    <span className="text-[13px] text-muted-foreground shrink-0 tabular-nums">
                      S${chore.pocket_money_value.toFixed(2)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )
      })}
      {overflow > 0 && (
        <p className="text-[13px] text-muted-foreground italic">+{overflow} more</p>
      )}
    </div>
  )
}

// ── CalendarSection ────────────────────────────────────────────────────────────

const MAX_EVENTS = 8

interface CalItem {
  id: string
  title: string
  chip: string
  time: string | null
  color: string
  isToday: boolean
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
    const isToday = toDateStr(d) === todayStr
    items.push({
      id: ev.id,
      title: ev.title,
      chip: dayChip(d, todayStr),
      time: ev.end_at
        ? `${fmtTime(ev.start_at)} – ${fmtTime(ev.end_at)}`
        : fmtTime(ev.start_at),
      color: ev.color ?? "#3b82f6",
      isToday,
      sortMs: d.getTime(),
    })
  }

  for (const b of upcomingBirthdays) {
    items.push({
      id: `bd-${b.id}`,
      title: `${b.type === "birthday" ? "🎂" : "❤️"} ${b.name}`,
      chip: dayChip(b.occ, todayStr),
      time: null,
      color: b.color || "#ec4899",
      isToday: b.daysAway === 0,
      sortMs: b.occ.getTime(),
    })
  }

  items.sort((a, b) => a.sortMs - b.sortMs)

  if (items.length === 0) {
    return (
      <p className="text-[15px] text-muted-foreground italic">Nothing in the calendar this week</p>
    )
  }

  const total    = items.length
  const overflow = total > MAX_EVENTS ? total - MAX_EVENTS : 0
  const shown    = overflow > 0 ? items.slice(0, MAX_EVENTS) : items

  return (
    <div className="flex flex-col gap-2">
      {shown.map(item => (
        <div
          key={item.id}
          className={cn(
            "flex items-start gap-2",
            item.isToday && "opacity-100",
            !item.isToday && "opacity-80",
          )}
        >
          {/* Date chip */}
          <span
            className="shrink-0 inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold leading-none mt-0.5 whitespace-nowrap"
            style={{
              backgroundColor: `${item.color}22`,
              color: item.color,
            }}
          >
            {item.chip}
          </span>

          {/* Title + time */}
          <div className="min-w-0 flex-1">
            <p className={cn(
              "text-[15px] leading-snug truncate",
              item.isToday ? "font-bold" : "font-medium",
            )}>
              {item.title}
            </p>
            {item.time && (
              <p className="text-[13px] text-muted-foreground">{item.time}</p>
            )}
          </div>
        </div>
      ))}
      {overflow > 0 && (
        <p className="text-[13px] text-muted-foreground italic">+{overflow} more</p>
      )}
    </div>
  )
}

// ── PlantsSection ──────────────────────────────────────────────────────────────

function PlantsSection({
  members, wallMemberPlants, familyCount, familyMax, familyGoal, growingPlantCount,
}: {
  members: Member[]
  wallMemberPlants: WallMemberPlant[]
  familyCount: number
  familyMax: number
  familyGoal: boolean
  growingPlantCount: number
}) {
  return (
    <div className="h-full flex flex-col items-center justify-between gap-2">
      {/* Growing plant */}
      <div className="shrink-0">
        <GrowingPlant count={growingPlantCount} size="sm" />
      </div>

      {/* Family total */}
      <p className={cn(
        "text-[20px] font-black tabular-nums leading-none shrink-0",
        familyGoal ? "text-green-500" : "text-foreground",
      )}>
        🌳 {familyCount}
        <span className="text-[14px] font-semibold text-muted-foreground"> / {familyMax}</span>
      </p>

      {/* Per-member compact row */}
      {members.length > 0 && (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 shrink-0">
          {members.map(m => {
            const count = new Set(
              wallMemberPlants.filter(wp => wp.member_id === m.id).map(wp => wp.plant_id)
            ).size
            const goal = count >= 30
            return (
              <span key={m.id} className="text-[15px] font-semibold tabular-nums">
                {m.avatar_emoji ?? "👤"}{" "}
                <span className={goal ? "text-green-500" : "text-foreground"}>
                  {count}{goal ? "✨" : ""}
                </span>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
