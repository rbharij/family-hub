"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
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
  DAY_LABELS, DAY_FULL, MEAL_EMOJIS,
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
    return `${weekStart.toLocaleDateString("en-AU", opts)} – ${weekEnd.toLocaleDateString("en-AU", opts)} ${weekEnd.getFullYear()}`
  })()

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col lg:h-full p-3 lg:p-4 gap-3">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevWeek}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextWeek}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <h2 className="text-base font-semibold shrink-0">{weekLabel}</h2>
        {!isThisWeek && (
          <Button variant="outline" size="sm" className="h-8" onClick={goThisWeek}>
            This week
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => setCopyDialogOpen(true)}
        >
          <Copy className="h-3.5 w-3.5" />
          Copy last week
        </Button>

        <div className="ml-auto flex items-center gap-3">
          <SummaryPill emoji="🍽️" count={dinnersPlanned} total={7} label="dinners" loading={loading} />
        </div>
      </div>

      {/* ── Desktop: 7-column grid ──────────────────────────────────────── */}
      <ErrorBoundary label="Meal grid">
        <div className="hidden lg:grid lg:grid-cols-7 flex-1 min-h-0 gap-2 overflow-hidden relative">
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
                    "flex flex-col items-center rounded-xl px-3 py-2 min-w-[44px] min-h-[44px] shrink-0 transition-colors",
                    mobileDay === di
                      ? "bg-primary text-primary-foreground"
                      : isToday
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted",
                  )}
                >
                  <span className="text-sm font-medium">{DAY_LABELS[di]}</span>
                  <span className="text-xl font-bold leading-tight">{day.getDate()}</span>
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

function SummaryPill({ emoji, count, total, label, loading }: {
  emoji: string; count: number; total: number; label: string; loading: boolean
}) {
  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <span>{emoji}</span>
      {loading
        ? <Skeleton className="h-4 w-20 rounded" />
        : <span><strong className="text-foreground">{count}</strong>/{total} {label}</span>
      }
    </div>
  )
}

// ── Day column ─────────────────────────────────────────────────────────────────

function DayColumn({
  day, dayIdx, isToday,
  dinnerMeal, lunchMeal, childMembers, getLunchbox, onSlotClick, dayPlants, mobile = false,
}: {
  day: Date
  dayIdx: number
  isToday: boolean
  dinnerMeal: Meal | null
  lunchMeal: Meal | null
  childMembers: FamilyMember[]
  getLunchbox: (memberId: string) => Meal | null
  onSlotClick: (type: MealType, meal: Meal | null, forMemberId: string | null, forMemberName: string | null) => void
  dayPlants?: { count: number; plants: { name: string; emoji: string | null }[] }
  mobile?: boolean
}) {
  return (
    <div className={cn(
      "flex flex-col rounded-lg overflow-hidden bg-card",
      "border-2",
      isToday ? "border-primary" : "border-border",
      mobile ? "min-h-[280px]" : "h-full",
    )}>
      {/* Day header */}
      <div className={cn(
        "shrink-0 px-3 py-2",
        isToday
          ? "bg-primary text-primary-foreground"
          : "bg-muted border-b-2 border-border",
      )}>
        <div className="flex items-baseline gap-1.5">
          <span className="text-base font-bold">
            {mobile ? DAY_FULL[dayIdx] : DAY_LABELS[dayIdx]}
          </span>
          <span className={cn("text-sm font-medium", isToday ? "opacity-80" : "text-muted-foreground")}>
            {day.getDate()}
          </span>
          {isToday && (
            <span className="ml-auto text-xs font-bold uppercase tracking-wider opacity-75">
              Today
            </span>
          )}
        </div>
        {dayPlants && dayPlants.count > 0 && (
          <div className={cn(
            "flex items-center gap-1 mt-0.5 flex-wrap",
            isToday ? "opacity-90" : "",
          )}>
            <span className="text-[10px] font-semibold opacity-70">🌿</span>
            {dayPlants.plants.slice(0, 4).map((p, i) => (
              <span key={i} className="text-sm leading-none" title={p.name}>
                {p.emoji ?? "🌿"}
              </span>
            ))}
            {dayPlants.count > 4 && (
              <span className="text-[10px] font-medium opacity-70">+{dayPlants.count - 4}</span>
            )}
          </div>
        )}
      </div>

      {/* Meal slots — uniform dividers via divide-y */}
      <div className={cn("flex flex-col flex-1 divide-y-2", isToday ? "divide-primary/20" : "divide-border")}>
        <MealSlot
          label="Dinner"
          emoji={MEAL_EMOJIS.dinner}
          meal={dinnerMeal}
          mobile={mobile}
          onClick={() => onSlotClick("dinner", dinnerMeal, null, null)}
        />

        <MealSlot
          label="Lunch"
          emoji={MEAL_EMOJIS.lunch}
          meal={lunchMeal}
          mobile={mobile}
          onClick={() => onSlotClick("lunch", lunchMeal, null, null)}
        />

        {childMembers.map((child) => {
          const meal = getLunchbox(child.id)
          return (
            <LunchboxSlot
              key={child.id}
              child={child}
              meal={meal}
              mobile={mobile}
              onClick={() => onSlotClick("lunchbox", meal, child.id, child.name)}
            />
          )
        })}

        {childMembers.length === 0 && (
          <MealSlot
            label="Lunchbox"
            emoji={MEAL_EMOJIS.lunchbox}
            meal={null}
            mobile={mobile}
            onClick={() => onSlotClick("lunchbox", null, null, null)}
          />
        )}
      </div>
    </div>
  )
}

// ── Generic meal slot (Dinner) ────────────────────────────────────────────────

function MealSlot({ label, emoji, meal, mobile, onClick }: {
  label: string; emoji: string; meal: Meal | null; mobile: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex flex-col items-start w-full text-left transition-colors",
        mobile ? "px-4 py-4 min-h-[100px]" : "px-3 py-3 flex-1 min-h-[80px]",
        meal ? "hover:bg-accent/40" : "hover:bg-muted/50",
      )}
    >
      <div className="flex items-center gap-1.5 mb-2 shrink-0">
        <span className="text-sm leading-none">{emoji}</span>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      {meal ? (
        <div className="flex-1 min-w-0 w-full">
          <p className={cn("font-semibold leading-snug", mobile ? "text-lg" : "text-base")}>
            {meal.title}
          </p>
          {meal.notes && (
            <p className={cn(
              "text-muted-foreground leading-snug mt-0.5 line-clamp-2",
              mobile ? "text-base" : "text-sm",
            )}>
              {meal.notes}
            </p>
          )}
        </div>
      ) : (
        <p className={cn("text-muted-foreground/40 italic", mobile ? "text-base" : "text-sm")}>
          Tap to add…
        </p>
      )}
    </button>
  )
}

// ── Per-child lunchbox slot ────────────────────────────────────────────────────

function LunchboxSlot({ child, meal, mobile, onClick }: {
  child: FamilyMember; meal: Meal | null; mobile: boolean; onClick: () => void
}) {
  const accentColor = child.color ?? "#6366f1"

  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex flex-col items-start w-full text-left transition-colors",
        mobile ? "px-4 py-4 min-h-[100px]" : "px-3 py-3 flex-1 min-h-[80px]",
        meal ? "hover:bg-accent/40" : "hover:bg-muted/50",
      )}
    >
      {/* Child label badge */}
      <div className="flex items-center gap-1.5 mb-2 shrink-0">
        <span
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold"
          style={{
            backgroundColor: `${accentColor}20`,
            color: accentColor,
          }}
        >
          {child.avatar_emoji && <span className="leading-none">{child.avatar_emoji}</span>}
          {MEAL_EMOJIS.lunchbox}
          <span className="uppercase tracking-wider">{child.name}</span>
        </span>
      </div>

      {meal ? (
        <div className="flex-1 min-w-0 w-full">
          <p className={cn("font-semibold leading-snug", mobile ? "text-lg" : "text-base")}>
            {meal.title}
          </p>
          {meal.notes && (
            <p className={cn(
              "text-muted-foreground leading-snug mt-0.5 line-clamp-2",
              mobile ? "text-base" : "text-sm",
            )}>
              {meal.notes}
            </p>
          )}
        </div>
      ) : (
        <p className={cn("italic", mobile ? "text-base" : "text-sm")}
          style={{ color: `${accentColor}60` }}>
          Tap to add…
        </p>
      )}
    </button>
  )
}
