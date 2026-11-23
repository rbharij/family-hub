"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, Copy, Plus, Sparkles } from "lucide-react"
import { MemberAvatar } from "@/components/member-avatar"
import { Button, buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase"
import { useRealtimeChannel } from "@/lib/use-realtime"
import { ErrorBoundary } from "@/components/error-boundary"
import {
  startOfWeek, addDays, toDateStr, weekDays,
  DAY_LABELS, DAY_FULL,
  type Meal, type MealType, type FamilyMember,
} from "./_utils"
import { SLOT_STYLES, type SlotKind } from "./_slot-style"
import { SCHOOL_LUNCH_TITLE } from "@/lib/meal-planner"
import { MealEditor } from "./_meal-editor"

// ── Stable realtime config ─────────────────────────────────────────────────────
const MEALS_TABLES = [{ table: "meals" }, { table: "member_weekly_plants" }] as const

// ── Page ───────────────────────────────────────────────────────────────────────

export default function MealsPage() {
  const today = new Date(); today.setHours(0, 0, 0, 0)

  const [weekStart, setWeekStart]           = useState(startOfWeek(today))
  const [meals, setMeals]                   = useState<Meal[]>([])
  const [childMembers, setChildMembers]     = useState<FamilyMember[]>([])
  const [loading, setLoading]               = useState(true)
  const [copyDialogOpen, setCopyDialogOpen] = useState(false)
  const [copying, setCopying]               = useState(false)

  // Mobile: which day index is active (0–6)
  const [mobileDay, setMobileDay] = useState(() => {
    const tod = startOfWeek(today)
    const offset = Math.round((today.getTime() - tod.getTime()) / 86_400_000)
    return Math.min(6, Math.max(0, offset))
  })

  // Editor state
  const [editorOpen, setEditorOpen]         = useState(false)
  const [editingMeal, setEditingMeal]       = useState<Meal | null>(null)
  const [editDate, setEditDate]             = useState("")
  const [editDayIdx, setEditDayIdx]         = useState(0)
  const [editType, setEditType]             = useState<MealType>("dinner")
  const [editForMemberId, setEditForMemberId]   = useState<string | null>(null)
  const [editForMemberName, setEditForMemberName] = useState<string | null>(null)

  const [carDinnerDays, setCarDinnerDays]   = useState<number[]>([])
  const [carMember, setCarMember]           = useState<FamilyMember | null>(null)

  const [dayPlantMap, setDayPlantMap] = useState<Map<string, { count: number; plants: { name: string; emoji: string | null }[] }>>(new Map())

  const supabase        = useRef(createClient()).current
  const swipeStartX     = useRef<number | null>(null)
  const swipeStartY     = useRef<number | null>(null)
  const days            = weekDays(weekStart)
  const SWIPE_THRESHOLD = 50

  // ── Family members (children only) ─────────────────────────────────────────

  useEffect(() => {
    supabase.from("family_members").select("*").eq("is_child", true).then(({ data }) => {
      setChildMembers(data ?? [])
    })
    // Car dinner days from the meal planner setup (ignored if not set up yet)
    supabase.from("meal_planner_settings").select("car_dinner_days, car_dinner_member_id").limit(1).maybeSingle()
      .then(async ({ data }) => {
        if (!data) return
        setCarDinnerDays((data.car_dinner_days as number[] | null) ?? [])
        if (data.car_dinner_member_id) {
          const { data: m } = await supabase.from("family_members").select("*").eq("id", data.car_dinner_member_id).maybeSingle()
          setCarMember((m as FamilyMember | null) ?? null)
        }
      })
  }, [supabase])

  // ── Data ───────────────────────────────────────────────────────────────────

  const fetchMeals = useCallback(async () => {
    const end   = addDays(weekStart, 6)
    const wsStr = toDateStr(weekStart)

    const [mealsRes, wpRes, plantsRes] = await Promise.all([
      supabase
        .from("meals")
        .select("*")
        .gte("date", wsStr)
        .lte("date", toDateStr(end))
        .order("date"),
      supabase
        .from("member_weekly_plants")
        .select("plant_id, meal_id")
        .eq("week_start", wsStr),
      supabase
        .from("plants")
        .select("id, name, emoji"),
    ])

    const mealsData = mealsRes.data ?? []
    setMeals(mealsData)

    // Build dayPlantMap: date → { count unique plants, plants[] }
    const plantLib    = new Map(
      ((plantsRes.data ?? []) as { id: string; name: string; emoji: string | null }[]).map((p) => [p.id, p])
    )
    const mealDateMap = new Map((mealsData as { id: string; date: string }[]).map((m) => [m.id, m.date]))
    const dpMap       = new Map<string, { count: number; plants: { name: string; emoji: string | null }[] }>()

    for (const wp of (wpRes.data ?? []) as { plant_id: string; meal_id: string | null }[]) {
      if (!wp.meal_id) continue
      const date  = mealDateMap.get(wp.meal_id)
      const plant = plantLib.get(wp.plant_id)
      if (!date || !plant) continue
      const entry = dpMap.get(date) ?? { count: 0, plants: [] }
      // Deduplicate plant_ids across members for the same day
      if (!entry.plants.some((p) => p.name === plant.name)) {
        entry.count++
        entry.plants.push({ name: plant.name, emoji: plant.emoji })
      }
      dpMap.set(date, entry)
    }
    setDayPlantMap(dpMap)
    setLoading(false)
  }, [supabase, weekStart])

  useEffect(() => { setLoading(true); fetchMeals() }, [fetchMeals])

  useRealtimeChannel(supabase, `meals-week-${toDateStr(weekStart)}`, MEALS_TABLES, fetchMeals)

  // ── Helpers ────────────────────────────────────────────────────────────────

  function getDinner(date: string): Meal | null {
    return meals.find((m) => m.date === date && m.meal_type === "dinner") ?? null
  }

  function getLunch(date: string): Meal | null {
    return meals.find((m) => m.date === date && m.meal_type === "lunch") ?? null
  }

  function getCarDinner(date: string): Meal | null {
    return meals.find((m) => m.date === date && m.meal_type === "car_dinner") ?? null
  }

  function getLunchbox(date: string, memberId: string): Meal | null {
    return meals.find(
      (m) => m.date === date && m.meal_type === "lunchbox" && m.for_member_id === memberId,
    ) ?? null
  }

  function openEditor(
    date: string, dayIdx: number, type: MealType, meal: Meal | null,
    forMemberId: string | null = null, forMemberName: string | null = null,
  ) {
    setEditDate(date)
    setEditDayIdx(dayIdx)
    setEditType(type)
    setEditingMeal(meal)
    setEditForMemberId(forMemberId)
    setEditForMemberName(forMemberName)
    setEditorOpen(true)
  }

  function closeEditor() {
    setEditorOpen(false)
    setTimeout(() => setEditingMeal(null), 300)
  }

  // ── Mobile swipe navigation ────────────────────────────────────────────────

  function mobileSwipeStart(e: React.TouchEvent) {
    swipeStartX.current = e.touches[0].clientX
    swipeStartY.current = e.touches[0].clientY
  }
  function mobileSwipeEnd(e: React.TouchEvent) {
    if (swipeStartX.current === null || swipeStartY.current === null) return
    const dx = e.changedTouches[0].clientX - swipeStartX.current
    const dy = e.changedTouches[0].clientY - swipeStartY.current
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) {
        if (mobileDay < 6) setMobileDay((d) => d + 1)
        else { setWeekStart((w) => addDays(w, 7)); setMobileDay(0) }
      } else {
        if (mobileDay > 0) setMobileDay((d) => d - 1)
        else { setWeekStart((w) => addDays(w, -7)); setMobileDay(6) }
      }
    }
    swipeStartX.current = null
    swipeStartY.current = null
  }

  // ── Rows: one per kind of meal, so every day lines up ─────────────────────

  const weekDates = days.map(toDateStr)
  const hasCarRow = carDinnerDays.length > 0 || weekDates.some((d) => getCarDinner(d) !== null)
  const rows: MealRow[] = [
    { key: "dinner", kind: "dinner", label: "Dinner", member: null, getMeal: getDinner, enabled: () => true },
    { key: "lunch", kind: "lunch", label: "Lunch", member: null, getMeal: getLunch, enabled: () => true },
    ...childMembers.map((c): MealRow => ({
      key: `lunchbox-${c.id}`, kind: "lunchbox", label: c.name, member: c,
      getMeal: (d) => getLunchbox(d, c.id),
      enabled: (_d, di) => di < 5 || getLunchbox(_d, c.id) !== null,
    })),
    ...(childMembers.length === 0 ? [{ key: "lunchbox", kind: "lunchbox" as const, label: "Lunchbox", member: null, getMeal: () => null, enabled: (_d: string, di: number) => di < 5 }] : []),
    ...(hasCarRow ? [{
      key: "car", kind: "car_dinner" as const, label: carMember?.name ?? "Car dinner", member: carMember,
      getMeal: getCarDinner,
      enabled: (d: string, di: number) => carDinnerDays.includes(di) || getCarDinner(d) !== null,
    }] : []),
  ]

  // ── Copy Last Week ─────────────────────────────────────────────────────────

  async function handleCopyLastWeek() {
    setCopying(true)
    const lastWeekStart = addDays(weekStart, -7)
    const lastWeekEnd   = addDays(lastWeekStart, 6)

    const { data: lastWeekMeals } = await supabase
      .from("meals")
      .select("*")
      .gte("date", toDateStr(lastWeekStart))
      .lte("date", toDateStr(lastWeekEnd))

    if (lastWeekMeals && lastWeekMeals.length > 0) {
      const inserts = lastWeekMeals
        .map((m: Meal) => {
          const offset = Math.round(
            (new Date(m.date).getTime() - lastWeekStart.getTime()) / 86_400_000,
          )
          const targetDate = toDateStr(addDays(weekStart, offset))
          const occupied = meals.some(
            (x) => x.date === targetDate && x.meal_type === m.meal_type && x.for_member_id === m.for_member_id,
          )
          if (occupied) return null
          return {
            date: targetDate,
            meal_type: m.meal_type,
            title: m.title,
            notes: m.notes,
            for_member_id: m.for_member_id,
          }
        })
        .filter(Boolean)

      if (inserts.length > 0) {
        await supabase.from("meals").insert(inserts)
      }
    }

    setCopying(false)
    setCopyDialogOpen(false)
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  function prevWeek() { setWeekStart((d) => addDays(d, -7)) }
  function nextWeek() { setWeekStart((d) => addDays(d, 7)) }
  function goThisWeek() { setWeekStart(startOfWeek(today)) }
  const isThisWeek = toDateStr(weekStart) === toDateStr(startOfWeek(today))

  // ── Summary ────────────────────────────────────────────────────────────────

  const dinnersPlanned = days.filter((d) => getDinner(toDateStr(d)) !== null).length

  // ── Week label ─────────────────────────────────────────────────────────────

  const weekEnd   = addDays(weekStart, 6)
  const weekLabel = (() => {
    const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }
    return `${weekStart.toLocaleDateString("en-GB", opts)} to ${weekEnd.toLocaleDateString("en-GB", opts)}`
  })()

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col lg:h-full p-4 lg:px-8 lg:py-7 gap-4 lg:gap-5">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 lg:gap-3 shrink-0 flex-wrap">
        <div className="mr-1 lg:mr-2">
          <h1 className="font-display text-[26px] lg:text-[34px] font-semibold tracking-tight leading-tight">Meals</h1>
          <p className="text-[14px] lg:text-[15px] text-muted-foreground">{weekLabel}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon" className="size-11 rounded-xl bg-card" onClick={prevWeek} aria-label="Previous week">
            <ChevronLeft className="size-5" />
          </Button>
          <Button variant="outline" size="icon" className="size-11 rounded-xl bg-card" onClick={nextWeek} aria-label="Next week">
            <ChevronRight className="size-5" />
          </Button>
          {!isThisWeek && (
            <Button variant="outline" className="h-11 px-4 rounded-xl bg-card" onClick={goThisWeek}>This week</Button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <SummaryPill count={dinnersPlanned} total={7} label="dinners planned" loading={loading} />
          <Link href="/meals/planner" className={cn(buttonVariants(), "h-11 px-4 rounded-xl gap-2")}>
            <Sparkles className="size-4" />
            <span className="hidden sm:inline">Plan my week</span>
          </Link>
          <Button variant="outline" className="h-11 px-4 rounded-xl bg-card gap-2" onClick={() => setCopyDialogOpen(true)}>
            <Copy className="size-4" />
            <span className="hidden sm:inline">Copy last week</span>
          </Button>
        </div>
      </div>

      {/* ── Desktop: 7-column grid ──────────────────────────────────────── */}
      <ErrorBoundary label="Meal grid">
        <div className="hidden lg:block flex-1 min-h-0 overflow-y-auto relative">
          {loading ? (
            <div className="grid gap-2" style={{ gridTemplateColumns: GRID_COLS }}>
              {Array.from({ length: 8 * 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
            </div>
          ) : (
            <WeekGrid
              days={days}
              today={today}
              rows={rows}
              dayPlantMap={dayPlantMap}
              onSlotClick={openEditor}
            />
          )}
        </div>

        {/* ── Mobile: single-day view ─────────────────────────────────────── */}
        <div className="lg:hidden flex flex-col flex-1 min-h-0 gap-3">
          <div className="flex gap-1 overflow-x-auto pb-1 shrink-0">
            {days.map((day, di) => {
              const isToday    = toDateStr(day) === toDateStr(today)
              const dotCount   = rows.filter((r) => r.getMeal(toDateStr(day)) !== null).length
              return (
                <button
                  key={di}
                  onClick={() => setMobileDay(di)}
                  className={cn(
                    "flex flex-col items-center rounded-2xl px-3 py-2 min-w-[46px] min-h-[44px] shrink-0 transition-colors",
                    mobileDay === di
                      ? "bg-primary text-primary-foreground"
                      : isToday
                      ? "bg-foreground text-background"
                      : "bg-card border border-border",
                  )}
                >
                  <span className="text-sm font-medium">{DAY_LABELS[di]}</span>
                  <span className="font-display text-xl font-semibold leading-tight">{day.getDate()}</span>
                  <div className="flex gap-0.5 mt-0.5 h-1">
                    {Array.from({ length: Math.min(dotCount, 5) }).map((_, i) => (
                      <span
                        key={i}
                        className={cn(
                          "w-1 h-1 rounded-full",
                          mobileDay === di ? "bg-primary-foreground" : "bg-primary",
                        )}
                      />
                    ))}
                  </div>
                </button>
              )
            })}
          </div>

          <div
            className="flex-1 overflow-y-auto"
            onTouchStart={mobileSwipeStart}
            onTouchEnd={mobileSwipeEnd}
          >
            <DayList
              day={days[mobileDay]}
              dayIdx={mobileDay}
              isToday={toDateStr(days[mobileDay]) === toDateStr(today)}
              rows={rows}
              dayPlants={dayPlantMap.get(toDateStr(days[mobileDay]))}
              onSlotClick={openEditor}
            />
          </div>
        </div>
      </ErrorBoundary>

      {/* ── Editor ─────────────────────────────────────────────────────────── */}
      <MealEditor
        open={editorOpen}
        onClose={closeEditor}
        onSaved={fetchMeals}
        meal={editingMeal}
        date={editDate}
        dayIndex={editDayIdx}
        mealType={editType}
        forMemberId={editForMemberId}
        forMemberName={editForMemberName}
        allChildren={childMembers}
      />

      {/* ── Copy Last Week confirmation ──────────────────────────────────── */}
      <Dialog open={copyDialogOpen} onOpenChange={(o) => !o && setCopyDialogOpen(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Copy last week&apos;s meals?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will copy all meal entries from the previous week into any empty slots
            this week. Existing entries will not be overwritten.
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" size="sm" onClick={() => setCopyDialogOpen(false)} disabled={copying}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCopyLastWeek} disabled={copying}>
              {copying ? "Copying…" : "Copy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Summary pill ───────────────────────────────────────────────────────────────

function SummaryPill({ count, total, label, loading }: {
  count: number; total: number; label: string; loading: boolean
}) {
  if (loading) return <Skeleton className="h-9 w-40 rounded-full" />
  const pct = Math.round((count / total) * 100)
  return (
    <div className="hidden sm:flex flex-col items-end gap-1.5">
      <span className="text-sm font-semibold text-foreground/80 tabular-nums">{count} of {total} {label}</span>
      <span className="h-2 w-40 rounded-full bg-secondary overflow-hidden">
        <span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </span>
    </div>
  )
}

// ── Rows and slots ─────────────────────────────────────────────────────────────

const GRID_COLS = "132px repeat(7, minmax(0, 1fr))"

interface MealRow {
  key: string
  kind: SlotKind
  label: string
  member: FamilyMember | null
  getMeal: (date: string) => Meal | null
  /** Whether this row applies on a given day (e.g. car dinners only on class days) */
  enabled: (date: string, dayIdx: number) => boolean
}

type OpenEditor = (
  date: string, dayIdx: number, type: MealType, meal: Meal | null,
  forMemberId?: string | null, forMemberName?: string | null,
) => void

function openRow(row: MealRow, date: string, di: number, onSlotClick: OpenEditor) {
  onSlotClick(date, di, row.kind, row.getMeal(date), row.member?.id ?? null, row.member?.name ?? null)
}

// ── Desktop week grid ──────────────────────────────────────────────────────────

function WeekGrid({ days, today, rows, dayPlantMap, onSlotClick }: {
  days: Date[]
  today: Date
  rows: MealRow[]
  dayPlantMap: Map<string, { count: number; plants: { name: string; emoji: string | null }[] }>
  onSlotClick: OpenEditor
}) {
  const todayStr = toDateStr(today)
  return (
    <div className="grid gap-x-2 gap-y-2 pb-2" style={{ gridTemplateColumns: GRID_COLS }}>
      {/* Header row */}
      <div />
      {days.map((day, di) => {
        const ds = toDateStr(day)
        const isToday = ds === todayStr
        const plants = dayPlantMap.get(ds)
        return (
          <div key={ds} className={cn(
            "sticky top-0 z-10 flex items-center gap-2 rounded-2xl px-2.5 py-2 border",
            isToday ? "bg-foreground text-background border-foreground" : "bg-card border-border",
          )}>
            <span className="font-display text-[22px] font-semibold leading-none tabular-nums">{day.getDate()}</span>
            <div className="min-w-0 leading-tight">
              <p className="text-[12px] font-semibold uppercase tracking-[0.06em]">{DAY_LABELS[di]}{isToday ? " · Today" : ""}</p>
              {plants && plants.count > 0 && (
                <p className={cn("text-[11.5px] font-medium", isToday ? "opacity-80" : "text-muted-foreground")}>
                  {plants.count} plant{plants.count !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          </div>
        )
      })}

      {/* Meal rows */}
      {rows.map((row) => (
        <Row key={row.key} row={row} days={days} todayStr={todayStr} onSlotClick={onSlotClick} />
      ))}
    </div>
  )
}

function Row({ row, days, todayStr, onSlotClick }: {
  row: MealRow; days: Date[]; todayStr: string; onSlotClick: OpenEditor
}) {
  const style = SLOT_STYLES[row.kind]
  const Icon  = style.icon
  return (
    <>
      <div className="flex items-center gap-2 pr-1 min-w-0">
        {row.member ? (
          <span className="relative shrink-0">
            <MemberAvatar member={row.member} className="size-8 text-[14px]" />
            <span className={cn("absolute -bottom-1 -right-1 flex size-[18px] items-center justify-center rounded-full ring-2 ring-background", style.chip)}>
              <Icon className="size-2.5" />
            </span>
          </span>
        ) : (
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl", style.chip)}>
            <Icon className="size-4" />
          </span>
        )}
        <div className="min-w-0 leading-tight">
          <p className="text-[13px] font-semibold truncate">{row.kind === "lunchbox" || row.kind === "car_dinner" ? style.label : row.label}</p>
          {row.member && <p className="text-[12px] text-muted-foreground truncate">{row.member.name}</p>}
        </div>
      </div>
      {days.map((day, di) => {
        const ds = toDateStr(day)
        return (
          <div key={ds} className={cn("min-w-0 flex", ds === todayStr && row.enabled(ds, di) && "rounded-2xl ring-2 ring-primary/25")}>
            {row.enabled(ds, di) ? (
              <SlotCard kind={row.kind} meal={row.getMeal(ds)} onClick={() => openRow(row, ds, di, onSlotClick)} />
            ) : (
              <div className="flex-1 rounded-2xl bg-secondary/40 min-h-[84px]" aria-hidden="true" />
            )}
          </div>
        )
      })}
    </>
  )
}

// ── Mobile day list ────────────────────────────────────────────────────────────

function DayList({ day, dayIdx, isToday, rows, dayPlants, onSlotClick }: {
  day: Date
  dayIdx: number
  isToday: boolean
  rows: MealRow[]
  dayPlants?: { count: number; plants: { name: string; emoji: string | null }[] }
  onSlotClick: OpenEditor
}) {
  const ds = toDateStr(day)
  return (
    <div className={cn(
      "flex flex-col gap-2.5 rounded-[24px] border p-3",
      isToday ? "bg-accent/60 border-primary/30" : "bg-card border-border",
    )}>
      <div className="flex items-baseline gap-2 px-1">
        <p className="font-display text-[20px] font-semibold">{DAY_FULL[dayIdx]}</p>
        {isToday && <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-primary">Today</span>}
        {dayPlants && dayPlants.count > 0 && (
          <span className="ml-auto text-[13px] font-semibold text-accent-foreground">{dayPlants.count} plants</span>
        )}
      </div>
      {rows.filter((r) => r.enabled(ds, dayIdx)).map((row) => (
        <SlotCard
          key={row.key}
          kind={row.kind}
          meal={row.getMeal(ds)}
          member={row.member}
          showLabel
          mobile
          onClick={() => openRow(row, ds, dayIdx, onSlotClick)}
        />
      ))}
    </div>
  )
}

// ── Slot card (shared) ─────────────────────────────────────────────────────────

function SlotCard({ kind, meal, member = null, showLabel = false, mobile = false, onClick }: {
  kind: SlotKind
  meal: Meal | null
  member?: FamilyMember | null
  showLabel?: boolean
  mobile?: boolean
  onClick: () => void
}) {
  const style    = SLOT_STYLES[kind]
  const Icon     = style.icon
  const isSchool = kind === "lunchbox" && meal?.title === SCHOOL_LUNCH_TITLE

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex-1 flex flex-col items-start gap-1 w-full text-left rounded-2xl border transition-colors min-w-0",
        mobile ? "px-4 py-3 min-h-[76px]" : "px-3 py-2.5 min-h-[84px]",
        !meal
          ? cn("border-[1.5px] border-dashed bg-transparent", style.empty)
          : isSchool
          ? "bg-secondary/60 border-border text-muted-foreground hover:border-input"
          : style.filled,
      )}
    >
      {(showLabel || !meal) && (
        <span className="flex items-center gap-1.5 min-w-0 text-[11px] font-semibold uppercase tracking-[0.08em] opacity-80">
          {member && showLabel ? <MemberAvatar member={member} className="size-5 text-[10px]" /> : <Icon className="size-3.5" />}
          <span className="truncate">{showLabel ? `${style.label}${member ? ` · ${member.name}` : ""}` : "Add"}</span>
          {member && showLabel && <Icon className="size-3.5" />}
        </span>
      )}
      {meal && (
        <div className="min-w-0 w-full">
          <p className={cn("font-semibold leading-snug line-clamp-2 break-words", mobile ? "text-[16px]" : "text-[13.5px]")}>
            {isSchool ? "School lunch" : meal.title}
          </p>
          {meal.notes && !isSchool && (
            <p className={cn("leading-snug mt-0.5 line-clamp-1 opacity-75", mobile ? "text-[14px]" : "text-[12px]")}>{meal.notes}</p>
          )}
        </div>
      )}
      {!meal && !showLabel && null}
      {!meal && showLabel && (
        <span className={cn("flex items-center gap-1 font-medium", mobile ? "text-[15px]" : "text-[13px]")}>
          <Plus className="size-3.5" /> Add
        </span>
      )}
    </button>
  )
}
