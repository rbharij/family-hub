"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, Copy, Plus, Sparkles, Car } from "lucide-react"
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
        <div className="hidden lg:grid lg:grid-cols-7 flex-1 min-h-0 gap-2.5 overflow-hidden relative">
          {loading && (
            <div className="absolute inset-0 z-10 grid grid-cols-7 gap-2 pointer-events-none">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="space-y-2 p-2">
                  <Skeleton className="h-4 w-12 rounded" />
                  <Skeleton className="h-16 rounded-lg" />
                  <Skeleton className="h-16 rounded-lg" />
                </div>
              ))}
            </div>
          )}
          {days.map((day, di) => (
            <DayColumn
              key={di}
              day={day}
              dayIdx={di}
              isToday={toDateStr(day) === toDateStr(today)}
              dinnerMeal={getDinner(toDateStr(day))}
              lunchMeal={getLunch(toDateStr(day))}
              carDinnerMeal={getCarDinner(toDateStr(day))}
              showCarDinner={carDinnerDays.includes(di)}
              carMember={carMember}
              childMembers={childMembers}
              getLunchbox={(memberId) => getLunchbox(toDateStr(day), memberId)}
              onSlotClick={(type, meal, forMemberId, forMemberName) =>
                openEditor(toDateStr(day), di, type, meal, forMemberId, forMemberName)
              }
              dayPlants={dayPlantMap.get(toDateStr(day))}
            />
          ))}
        </div>

        {/* ── Mobile: single-day view ─────────────────────────────────────── */}
        <div className="lg:hidden flex flex-col flex-1 min-h-0 gap-3">
          <div className="flex gap-1 overflow-x-auto pb-1 shrink-0">
            {days.map((day, di) => {
              const isToday    = toDateStr(day) === toDateStr(today)
              const hasDinner  = getDinner(toDateStr(day)) !== null
              const hasLunch   = childMembers.some((c) => getLunchbox(toDateStr(day), c.id) !== null)
              const dotCount   = (hasDinner ? 1 : 0) + (hasLunch ? 1 : 0)
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
                    {Array.from({ length: dotCount }).map((_, i) => (
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
            <DayColumn
              day={days[mobileDay]}
              dayIdx={mobileDay}
              isToday={toDateStr(days[mobileDay]) === toDateStr(today)}
              dinnerMeal={getDinner(toDateStr(days[mobileDay]))}
              lunchMeal={getLunch(toDateStr(days[mobileDay]))}
              carDinnerMeal={getCarDinner(toDateStr(days[mobileDay]))}
              showCarDinner={carDinnerDays.includes(mobileDay)}
              carMember={carMember}
              childMembers={childMembers}
              getLunchbox={(memberId) => getLunchbox(toDateStr(days[mobileDay]), memberId)}
              onSlotClick={(type, meal, forMemberId, forMemberName) =>
                openEditor(toDateStr(days[mobileDay]), mobileDay, type, meal, forMemberId, forMemberName)
              }
              dayPlants={dayPlantMap.get(toDateStr(days[mobileDay]))}
              mobile
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

// ── Day column ─────────────────────────────────────────────────────────────────

function DayColumn({
  day, dayIdx, isToday,
  dinnerMeal, lunchMeal, carDinnerMeal, showCarDinner, carMember,
  childMembers, getLunchbox, onSlotClick, dayPlants, mobile = false,
}: {
  day: Date
  dayIdx: number
  isToday: boolean
  dinnerMeal: Meal | null
  lunchMeal: Meal | null
  carDinnerMeal: Meal | null
  showCarDinner: boolean
  carMember: FamilyMember | null
  childMembers: FamilyMember[]
  getLunchbox: (memberId: string) => Meal | null
  onSlotClick: (type: MealType, meal: Meal | null, forMemberId: string | null, forMemberName: string | null) => void
  dayPlants?: { count: number; plants: { name: string; emoji: string | null }[] }
  mobile?: boolean
}) {
  return (
    <div className={cn(
      "flex flex-col gap-2 rounded-[24px] border p-2 min-w-0",
      isToday ? "bg-accent/60 border-primary/30" : "bg-card border-border",
      mobile ? "min-h-[280px] p-3 gap-3" : "h-full overflow-y-auto",
    )}>
      {/* Day header */}
      <div className="shrink-0 flex items-center gap-2 px-1.5 pt-1">
        <span className={cn(
          "flex flex-col items-center justify-center rounded-xl px-2.5 py-1 min-w-[44px]",
          isToday ? "bg-foreground text-background" : "bg-secondary text-foreground",
        )}>
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em]">{DAY_LABELS[dayIdx]}</span>
          <span className="font-display text-[19px] font-semibold leading-none">{day.getDate()}</span>
        </span>
        <div className="min-w-0">
          {mobile && <p className="font-display text-[19px] font-semibold leading-tight">{DAY_FULL[dayIdx]}</p>}
          {isToday && !mobile && <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-primary">Today</p>}
          {dayPlants && dayPlants.count > 0 && (
            <p className="text-[12px] font-semibold text-accent-foreground">
              {dayPlants.count} plant{dayPlants.count !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>

      <MealSlot label="Dinner" meal={dinnerMeal} mobile={mobile} highlight
        onClick={() => onSlotClick("dinner", dinnerMeal, null, null)} />

      <MealSlot label="Lunch" meal={lunchMeal} mobile={mobile}
        onClick={() => onSlotClick("lunch", lunchMeal, null, null)} />

      {childMembers.map((child) => {
        const meal = getLunchbox(child.id)
        return (
          <LunchboxSlot key={child.id} child={child} meal={meal} mobile={mobile}
            onClick={() => onSlotClick("lunchbox", meal, child.id, child.name)} />
        )
      })}

      {(carDinnerMeal || showCarDinner) && (
        <SlotShell filled={Boolean(carDinnerMeal)} mobile={mobile}
          onClick={() => onSlotClick("car_dinner", carDinnerMeal, carMember?.id ?? carDinnerMeal?.for_member_id ?? null, carMember?.name ?? null)}>
          <span className="flex items-center gap-1.5 min-w-0">
            <Car className="size-3.5 text-muted-foreground" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground truncate">
              Car dinner{carMember ? ` · ${carMember.name}` : ""}
            </span>
          </span>
          {carDinnerMeal ? <MealText meal={carDinnerMeal} mobile={mobile} /> : <AddHint mobile={mobile} />}
        </SlotShell>
      )}

      {childMembers.length === 0 && (
        <MealSlot label="Lunchbox" meal={null} mobile={mobile}
          onClick={() => onSlotClick("lunchbox", null, null, null)} />
      )}
    </div>
  )
}

// ── Slot shell ──────────────────────────────────────────────────────────────────

function SlotShell({ filled, mobile, onClick, children, highlight = false }: {
  filled: boolean; mobile: boolean; onClick: () => void; children: React.ReactNode; highlight?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex flex-col items-start gap-1 w-full text-left rounded-2xl transition-colors min-w-0",
        mobile ? "px-4 py-3.5 min-h-[84px]" : "px-2.5 py-2.5 flex-1 min-h-[76px]",
        filled
          ? highlight
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "bg-background/70 border border-border hover:border-primary/40"
          : "border-[1.5px] border-dashed border-input hover:bg-secondary/60",
      )}
    >
      {children}
    </button>
  )
}

function MealText({ meal, mobile, onPrimary = false }: { meal: Meal; mobile: boolean; onPrimary?: boolean }) {
  return (
    <div className="min-w-0 w-full">
      <p className={cn("font-semibold leading-snug break-words", mobile ? "text-[17px]" : "text-[14px]")}>{meal.title}</p>
      {meal.notes && (
        <p className={cn(
          "leading-snug mt-0.5 line-clamp-2",
          onPrimary ? "opacity-80" : "text-muted-foreground",
          mobile ? "text-[15px]" : "text-[12px]",
        )}>
          {meal.notes}
        </p>
      )}
    </div>
  )
}

function AddHint({ mobile }: { mobile: boolean }) {
  return (
    <span className={cn("flex items-center gap-1 text-muted-foreground font-medium", mobile ? "text-[15px]" : "text-[13px]")}>
      <Plus className="size-3.5" /> Add
    </span>
  )
}

// ── Dinner / lunch slot ─────────────────────────────────────────────────────────

function MealSlot({ label, meal, mobile, onClick, highlight = false }: {
  label: string; meal: Meal | null; mobile: boolean; onClick: () => void; highlight?: boolean
}) {
  const onPrimary = Boolean(meal) && highlight
  return (
    <SlotShell filled={Boolean(meal)} mobile={mobile} onClick={onClick} highlight={highlight}>
      <span className={cn(
        "text-[11px] font-semibold uppercase tracking-[0.08em]",
        onPrimary ? "opacity-80" : "text-muted-foreground",
      )}>
        {label}
      </span>
      {meal ? <MealText meal={meal} mobile={mobile} onPrimary={onPrimary} /> : <AddHint mobile={mobile} />}
    </SlotShell>
  )
}

// ── Per-child lunchbox slot ────────────────────────────────────────────────────

function LunchboxSlot({ child, meal, mobile, onClick }: {
  child: FamilyMember; meal: Meal | null; mobile: boolean; onClick: () => void
}) {
  return (
    <SlotShell filled={Boolean(meal)} mobile={mobile} onClick={onClick}>
      <span className="flex items-center gap-1.5 min-w-0">
        <MemberAvatar member={child} className="size-5 text-[11px]" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground truncate">{child.name}</span>
      </span>
      {meal ? <MealText meal={meal} mobile={mobile} /> : <AddHint mobile={mobile} />}
    </SlotShell>
  )
}
