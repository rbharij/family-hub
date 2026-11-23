"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  Sparkles, Lock, LockOpen, RefreshCw, Pencil, Check, X, Loader2, Snowflake, Sunrise,
  ShoppingCart, ChefHat, BookmarkPlus, CircleCheck, Clock, BookOpen,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase"
import { useRealtimeChannel } from "@/lib/use-realtime"
import {
  buildShoppingList, shoppingItemLabel, weekdayIndex, addDaysStr,
  SLOT_LABELS, SOURCE_LABELS, LUNCH_KIND_LABELS, SCHOOL_LUNCH_TITLE,
  type MealPlanRow, type PlanDay, type PlannedMeal, type SlotKey, type WeekPlan, type FreezerItem, type RecipeDetail,
} from "@/lib/meal-planner"
import { DAY_FULL, DAY_LABELS, toDateStr } from "../_utils"
import { RecipeDialog } from "./_recipe-dialog"
import { SLOT_STYLES } from "../_slot-style"

const PLAN_TABLES = [{ table: "meal_plans" }, { table: "freezer_items" }] as const
const SLOTS: SlotKey[] = ["dinner", "lunch", "lunchbox", "car_dinner"]

export function PlanView({ weekStart, onOpenSetup }: { weekStart: string; onOpenSetup: () => void }) {
  const supabase = useRef(createClient()).current

  const [row, setRow]             = useState<MealPlanRow | null>(null)
  const [freezer, setFreezer]     = useState<FreezerItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [generating, setGenerating] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busySlot, setBusySlot]   = useState<string | null>(null) // `${date}|${slot}`
  const [instructions, setInstructions] = useState("")
  const [showShopping, setShowShopping] = useState(false)
  const [openMeal, setOpenMeal]   = useState<{ date: string; slot: SlotKey } | null>(null)

  const fetchData = useCallback(async () => {
    const [planRes, frzRes] = await Promise.all([
      supabase.from("meal_plans").select("*").eq("week_start", weekStart).maybeSingle(),
      supabase.from("freezer_items").select("*").order("frozen_on"),
    ])
    setRow((planRes.data as MealPlanRow | null) ?? null)
    setFreezer((frzRes.data ?? []) as FreezerItem[])
    setLoading(false)
  }, [supabase, weekStart])

  useEffect(() => { setLoading(true); fetchData() }, [fetchData])
  useRealtimeChannel(supabase, `meal-planner-${weekStart}`, PLAN_TABLES, fetchData)

  const plan = row?.plan ?? null
  const shopping = useMemo(() => (plan ? buildShoppingList(plan) : []), [plan])

  // ── Server actions ─────────────────────────────────────────────────────────

  async function generate(keepLocked: boolean) {
    setGenerating(true)
    try {
      const res  = await fetch("/api/meal-plan/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekStart, keepLocked, instructions: instructions.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Something went wrong")
      setRow(data.plan)
      toast.success("Draft plan ready")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the plan")
    } finally {
      setGenerating(false)
    }
  }

  async function requestOptions(date: string, slot: SlotKey, hint?: string) {
    setBusySlot(`${date}|${slot}`)
    try {
      const res  = await fetch("/api/meal-plan/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekStart, date, slot, hint }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Something went wrong")
      setRow(data.plan)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't get more options")
    } finally {
      setBusySlot(null)
    }
  }

  async function chooseOption(date: string, slot: SlotKey, index: number) {
    setBusySlot(`${date}|${slot}`)
    try {
      const res  = await fetch("/api/meal-plan/choose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekStart, date, slot, index }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Something went wrong")
      setRow(data.plan)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't choose that option")
    } finally {
      setBusySlot(null)
    }
  }

  async function confirm() {
    setConfirming(true)
    try {
      const res  = await fetch("/api/meal-plan/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekStart }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Something went wrong")
      const bits = [`${data.meals} meals added`]
      if (data.shopping) bits.push(`${data.shopping} shopping items`)
      if (data.freezer) bits.push(`${data.freezer} freezer portions used`)
      toast.success(`Plan confirmed: ${bits.join(", ")}`)
      fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't confirm the plan")
    } finally {
      setConfirming(false)
    }
  }

  // ── Local edits (saved straight to the plan) ───────────────────────────────

  async function savePlan(next: WeekPlan) {
    if (!row) return
    const prev = row
    setRow({ ...row, plan: next })
    const { error } = await supabase.from("meal_plans").update({ plan: next }).eq("id", row.id)
    if (error) { setRow(prev); toast.error("Couldn't save the change") }
  }

  function updateMeal(date: string, slot: SlotKey, patch: Partial<PlannedMeal>) {
    if (!plan) return
    const days = plan.days.map((d) => {
      if (d.date !== date || !d[slot]) return d
      return { ...d, [slot]: { ...d[slot]!, ...patch } } as PlanDay
    })
    savePlan({ ...plan, days })
  }

  async function freezeExtra(date: string, meal: PlannedMeal) {
    if (!meal.freeze_portions) return
    const { error } = await supabase.from("freezer_items").insert({
      dish: meal.title, portions: meal.freeze_portions, frozen_on: date,
    })
    if (error) { toast.error("Couldn't add to the freezer"); return }
    updateMeal(date, "dinner", { frozen_done: true })
    toast.success(`${meal.freeze_portions} portions of ${meal.title} added to the freezer`)
  }

  async function markBatchDone() {
    if (!plan?.batch_session) return
    const b = plan.batch_session
    const inserts = b.dishes
      .filter((d) => d.portions_to_freeze > 0)
      .map((d) => ({ dish: d.title, portions: d.portions_to_freeze, frozen_on: b.date }))
    if (inserts.length) {
      const { error } = await supabase.from("freezer_items").insert(inserts)
      if (error) { toast.error("Couldn't add to the freezer"); return }
    }
    await savePlan({ ...plan, batch_session: { ...b, done: true } })
    toast.success("Batch cook added to the freezer")
  }

  async function saveToRecipes(meal: PlannedMeal, recipe: RecipeDetail | null = meal.recipe ?? null) {
    const ings = recipe?.ingredients?.length ? recipe.ingredients : (meal.ingredients ?? [])
    const parts: string[] = []
    if (recipe) parts.push(`Serves ${recipe.serves}. Prep ${recipe.prep_minutes ?? "?"} min, cook ${recipe.cook_minutes ?? "?"} min.`)
    if (ings.length) parts.push(`Ingredients:\n${ings.map((i) => `- ${i.qty ? `${i.name} (${i.qty})` : i.name}`).join("\n")}`)
    if (recipe?.steps.length) parts.push(`Method:\n${recipe.steps.map((s, n) => `${n + 1}. ${s}`).join("\n")}`)
    if (recipe?.tips?.length) parts.push(`Tips:\n${recipe.tips.map((t) => `- ${t}`).join("\n")}`)
    const notes = parts.length ? parts.join("\n\n") : meal.notes ?? null
    const { error } = await supabase.from("recipes").insert({ title: meal.title, notes, tags: [] })
    if (error) toast.error("Couldn't save the recipe")
    else toast.success(`${meal.title} saved to recipes`)
  }

  // ── Defrost reminders (tomorrow's freezer meals) ───────────────────────────

  const todayStr    = toDateStr(new Date())
  const tomorrowStr = addDaysStr(todayStr, 1)
  const defrost = useMemo(() => {
    const day = plan?.days.find((d) => d.date === tomorrowStr)
    if (!day) return []
    return SLOTS.map((s) => day[s]).filter((m): m is PlannedMeal => Boolean(m && m.source === "freezer"))
  }, [plan, tomorrowStr])

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="grid gap-3 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-[24px]" />)}
      </div>
    )
  }

  if (!plan) {
    return (
      <div className="rounded-[28px] bg-card border border-border p-6 lg:p-10 max-w-2xl flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <Sparkles className="size-6" />
          </span>
          <div>
            <h2 className="font-display text-[24px] font-semibold leading-tight">No plan for this week yet</h2>
            <p className="text-muted-foreground text-[15px]">
              Claude will read the calendar, the freezer and everyone&apos;s preferences, then draft dinners, lunches, lunchboxes and car dinners.
            </p>
          </div>
        </div>
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Anything special this week? e.g. Guests on Saturday, use up the salmon, no curry"
          className="min-h-[80px] text-[15px]"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button className="h-12 px-5 rounded-xl text-[15px] gap-2" onClick={() => generate(true)} disabled={generating}>
            {generating ? <Loader2 className="size-5 animate-spin" /> : <Sparkles className="size-5" />}
            {generating ? "Planning the week… (up to a minute)" : "Plan my week"}
          </Button>
          <Button variant="ghost" className="h-12 rounded-xl" onClick={onOpenSetup}>Check setup first</Button>
        </div>
      </div>
    )
  }

  const confirmed = row?.status === "confirmed"

  return (
    <div className="flex flex-col gap-4">
      {/* ── Status bar ───────────────────────────────────────────────────── */}
      <div className="rounded-[24px] bg-card border border-border p-4 lg:p-5 flex flex-col lg:flex-row lg:items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn(
              "rounded-full px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.06em]",
              confirmed ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground",
            )}>
              {confirmed ? "Confirmed" : "Draft"}
            </span>
            {row?.source === "auto" && !confirmed && (
              <span className="text-[13px] text-muted-foreground">Drafted automatically</span>
            )}
          </div>
          {plan.summary && <p className="mt-2 text-[15px] leading-snug">{plan.summary}</p>}
          <p className="mt-1 text-[13px] text-muted-foreground">
            Click any meal to see the recipe and other options. Lock the ones you want to keep, then confirm to fill the Meals page, use freezer portions and add to the shopping list.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button variant="outline" className="h-11 rounded-xl bg-card gap-2" onClick={() => setShowShopping((s) => !s)}>
            <ShoppingCart className="size-4" /> {shopping.length} item{shopping.length === 1 ? "" : "s"}
          </Button>
          <Button variant="outline" className="h-11 rounded-xl bg-card gap-2" onClick={() => generate(true)} disabled={generating || confirming}>
            {generating ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {generating ? "Replanning…" : "Replan unlocked"}
          </Button>
          <Button className="h-11 rounded-xl gap-2 px-5" onClick={confirm} disabled={confirming || generating}>
            {confirming ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {confirmed ? "Confirm again" : "Confirm plan"}
          </Button>
        </div>
      </div>

      {/* ── Defrost reminder ─────────────────────────────────────────────── */}
      {defrost.length > 0 && (
        <div className="flex items-center gap-3 rounded-2xl bg-accent text-accent-foreground px-4 py-3">
          <Snowflake className="size-5 shrink-0" />
          <p className="text-[15px]">
            <span className="font-semibold">Defrost tonight:</span> take {defrost.map((m) => m.title).join(" and ")} out of the freezer for tomorrow.
          </p>
        </div>
      )}

      {/* ── Shopping preview ─────────────────────────────────────────────── */}
      {showShopping && (
        <div className="rounded-[24px] bg-card border border-border p-5">
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-3">
            Shopping list (added to Groceries when you confirm)
          </p>
          {shopping.length === 0 ? (
            <p className="text-muted-foreground">Nothing to buy: everything comes from the freezer or leftovers.</p>
          ) : (
            <ul className="columns-1 sm:columns-2 lg:columns-4 gap-6 text-[14px]">
              {shopping.map((s) => <li key={s.name} className="break-inside-avoid py-0.5">{shoppingItemLabel(s)}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* ── Batch cook session ───────────────────────────────────────────── */}
      {plan.batch_session && (
        <div className="rounded-[24px] bg-card border border-border p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary shrink-0">
            <ChefHat className="size-6" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-display text-[19px] font-semibold">
              Batch cook on {DAY_FULL[weekdayIndex(plan.batch_session.date)]}
            </p>
            <p className="text-[14px] text-muted-foreground">
              {plan.batch_session.dishes.map((d) => `${d.title} (freeze ${d.portions_to_freeze})`).join(" · ")}
            </p>
            {plan.batch_session.notes && <p className="text-[13px] text-muted-foreground mt-0.5">{plan.batch_session.notes}</p>}
          </div>
          {plan.batch_session.done ? (
            <span className="flex items-center gap-1.5 text-[14px] font-semibold text-primary"><CircleCheck className="size-4" /> In the freezer</span>
          ) : (
            <Button variant="outline" className="h-11 rounded-xl bg-card gap-2" onClick={markBatchDone}>
              <Snowflake className="size-4" /> Done, add to freezer
            </Button>
          )}
        </div>
      )}

      {/* ── Days ─────────────────────────────────────────────────────────── */}
      {/* Wide screens: rows by meal type so every day lines up */}
      <div className="hidden xl:block">
        <PlanGrid
          plan={plan}
          todayStr={todayStr}
          freezer={freezer}
          busySlot={busySlot}
          onUpdate={updateMeal}
          onOpen={(date, slot) => setOpenMeal({ date, slot })}
        />
      </div>

      {/* Smaller screens: one card per day */}
      <div className="grid gap-3 md:grid-cols-2 xl:hidden">
        {plan.days.map((day) => (
          <DayCard
            key={day.date}
            day={day}
            isToday={day.date === todayStr}
            isBatchDay={plan.batch_session?.date === day.date}
            freezer={freezer}
            busySlot={busySlot}
            onUpdate={(slot, patch) => updateMeal(day.date, slot, patch)}
            onFreeze={(meal) => freezeExtra(day.date, meal)}
            onSaveRecipe={saveToRecipes}
            onOpen={(slot) => setOpenMeal({ date: day.date, slot })}
          />
        ))}
      </div>

      {openMeal && (() => {
        const day  = plan.days.find((d) => d.date === openMeal.date)
        const meal = day?.[openMeal.slot] ?? null
        return (
          <RecipeDialog
            open={Boolean(meal)}
            onClose={() => setOpenMeal(null)}
            weekStart={weekStart}
            date={openMeal.date}
            slot={openMeal.slot}
            meal={meal}
            lunchKind={openMeal.slot === "lunchbox" ? day?.lunchbox?.kind : undefined}
            busy={busySlot === `${openMeal.date}|${openMeal.slot}`}
            onChoose={(index) => chooseOption(openMeal.date, openMeal.slot, index)}
            onMoreOptions={(hint) => requestOptions(openMeal.date, openMeal.slot, hint)}
            onToggleLock={() => meal && updateMeal(openMeal.date, openMeal.slot, { locked: !meal.locked })}
            onSaveRecipe={(recipe) => meal && saveToRecipes(meal, recipe)}
            onFreeze={() => meal && freezeExtra(openMeal.date, meal)}
          />
        )
      })()}
    </div>
  )
}

// ── Wide-screen grid ─────────────────────────────────────────────────────────

function PlanGrid({ plan, todayStr, freezer, busySlot, onUpdate, onOpen }: {
  plan: WeekPlan
  todayStr: string
  freezer: FreezerItem[]
  busySlot: string | null
  onUpdate: (date: string, slot: SlotKey, patch: Partial<PlannedMeal>) => void
  onOpen: (date: string, slot: SlotKey) => void
}) {
  const rows = SLOTS.filter((slot) => plan.days.some((d) => d[slot]))
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: "120px repeat(7, minmax(0, 1fr))" }}>
      <div />
      {plan.days.map((day) => {
        const idx = weekdayIndex(day.date)
        const isToday = day.date === todayStr
        const isBatch = plan.batch_session?.date === day.date
        return (
          <div key={day.date} className={cn(
            "rounded-2xl border px-2.5 py-2 flex flex-col gap-0.5",
            isToday ? "bg-foreground text-background border-foreground" : "bg-card border-border",
          )}>
            <p className="flex items-baseline gap-1.5">
              <span className="font-display text-[20px] font-semibold leading-none tabular-nums">{Number(day.date.slice(8, 10))}</span>
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em]">{DAY_LABELS[idx]}</span>
              {isBatch && <ChefHat className="size-3.5 ml-auto" aria-label="Batch cook day" />}
            </p>
            {day.day_note && (
              <p className={cn("text-[11.5px] leading-snug line-clamp-3", isToday ? "opacity-80" : "text-muted-foreground")} title={day.day_note}>
                {day.day_note}
              </p>
            )}
          </div>
        )
      })}

      {rows.map((slot) => {
        const style = SLOT_STYLES[slot]
        const Icon  = style.icon
        return (
          <Fragment key={slot}>
            <div className="flex items-center gap-2">
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl", style.chip)}>
                <Icon className="size-4" />
              </span>
              <span className="text-[13px] font-semibold">{style.label}</span>
            </div>
            {plan.days.map((day) => {
              const meal = day[slot]
              return (
                <div key={day.date} className="flex min-w-0">
                  {meal ? (
                    <PlanCell
                      slot={slot}
                      meal={meal}
                      lunchKind={slot === "lunchbox" ? day.lunchbox?.kind : undefined}
                      inFreezer={!meal.freezer_item_id || freezer.some((f) => f.id === meal.freezer_item_id)}
                      busy={busySlot === `${day.date}|${slot}`}
                      onUpdate={(patch) => onUpdate(day.date, slot, patch)}
                      onOpen={() => onOpen(day.date, slot)}
                    />
                  ) : (
                    <div className="flex-1 rounded-2xl bg-secondary/40 min-h-[92px]" aria-hidden="true" />
                  )}
                </div>
              )
            })}
          </Fragment>
        )
      })}
    </div>
  )
}

function PlanCell({ slot, meal, lunchKind, inFreezer, busy, onUpdate, onOpen }: {
  slot: SlotKey
  meal: PlannedMeal
  lunchKind?: string
  inFreezer: boolean
  busy: boolean
  onUpdate: (patch: Partial<PlannedMeal>) => void
  onOpen: () => void
}) {
  const isSchool = slot === "lunchbox" && meal.title === SCHOOL_LUNCH_TITLE
  const isDinner = slot === "dinner"
  const style    = SLOT_STYLES[slot]
  const options  = (meal.alternatives?.length ?? 0) + 1

  if (isSchool) {
    return (
      <div className="flex-1 rounded-2xl border border-border bg-secondary/60 text-muted-foreground px-3 py-2.5 min-h-[92px]">
        <p className="text-[13.5px] font-semibold">School lunch</p>
        <p className="text-[12px]">No prep</p>
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen() } }}
      title="See recipe and options"
      className={cn(
        "group relative flex-1 min-w-0 rounded-2xl border px-3 py-2.5 min-h-[92px] flex flex-col gap-1.5 cursor-pointer transition-colors",
        style.filled, busy && "opacity-60",
      )}
    >
      <div className="absolute top-1.5 right-1.5 flex items-center">
        {busy && <Loader2 className="size-3.5 animate-spin mr-1" />}
        <span onClick={(e) => e.stopPropagation()}>
          <IconBtn label={meal.locked ? "Unlock" : "Lock"} onPrimary={isDinner} onClick={() => onUpdate({ locked: !meal.locked })}>
            {meal.locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />}
          </IconBtn>
        </span>
      </div>
      <p className="font-semibold text-[13.5px] leading-snug line-clamp-3 pr-7 break-words">{meal.title}</p>
      <div className="flex flex-wrap gap-1 mt-auto">
        {slot === "lunchbox" && lunchKind && (
          <Chip onPrimary={isDinner}>{lunchKind === "hot" ? "Hot" : "Cold"}</Chip>
        )}
        {meal.source === "cook_morning" && <Chip onPrimary={isDinner}><Sunrise className="size-3" />Morning</Chip>}
        {meal.source === "freezer" && <Chip onPrimary={isDinner}><Snowflake className="size-3" />{inFreezer ? "Freezer" : "Not in freezer"}</Chip>}
        {meal.source === "batch" && <Chip onPrimary={isDinner}><ChefHat className="size-3" />Batch</Chip>}
        {meal.source === "leftovers" && <Chip onPrimary={isDinner}>Leftovers</Chip>}
        {meal.cook_minutes ? <Chip onPrimary={isDinner}><Clock className="size-3" />{meal.cook_minutes}m</Chip> : null}
        {meal.extra_for_lunchbox && <Chip onPrimary={isDinner}>+ lunchbox</Chip>}
        {meal.freeze_portions ? <Chip onPrimary={isDinner}><Snowflake className="size-3" />×2</Chip> : null}
        {options > 1 && <Chip onPrimary={isDinner}>{options} options</Chip>}
      </div>
    </div>
  )
}

// ── Day card ───────────────────────────────────────────────────────────────────

function DayCard({
  day, isToday, isBatchDay, freezer, busySlot, onUpdate, onFreeze, onSaveRecipe, onOpen,
}: {
  day: PlanDay
  isToday: boolean
  isBatchDay: boolean
  freezer: FreezerItem[]
  busySlot: string | null
  onUpdate: (slot: SlotKey, patch: Partial<PlannedMeal>) => void
  onFreeze: (meal: PlannedMeal) => void
  onSaveRecipe: (meal: PlannedMeal) => void
  onOpen: (slot: SlotKey) => void
}) {
  const idx = weekdayIndex(day.date)
  const dateNum = Number(day.date.slice(8, 10))

  return (
    <div className={cn(
      "flex flex-col gap-2.5 rounded-[24px] border p-3 min-w-0",
      isToday ? "bg-accent/60 border-primary/30" : "bg-card border-border",
    )}>
      <div className="flex items-center gap-2.5 px-1 pt-1">
        <span className={cn(
          "flex flex-col items-center justify-center rounded-xl px-2.5 py-1 min-w-[44px]",
          isToday ? "bg-foreground text-background" : "bg-secondary text-foreground",
        )}>
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em]">{DAY_LABELS[idx]}</span>
          <span className="font-display text-[19px] font-semibold leading-none">{dateNum}</span>
        </span>
        <div className="min-w-0">
          <p className="font-display text-[17px] font-semibold leading-tight">{DAY_FULL[idx]}</p>
          {day.day_note && <p className="text-[12.5px] text-muted-foreground leading-snug">{day.day_note}</p>}
        </div>
      </div>

      {isBatchDay && (
        <div className="flex items-center gap-2 rounded-xl bg-secondary px-3 py-2 text-[13px] font-semibold">
          <ChefHat className="size-4" /> Batch cook day
        </div>
      )}

      {SLOTS.map((slot) => {
        const meal = day[slot]
        if (!meal) return null
        return (
          <MealCard
            key={slot}
            slot={slot}
            meal={meal}
            lunchKind={slot === "lunchbox" ? day.lunchbox?.kind : undefined}
            freezerItem={meal.freezer_item_id ? freezer.find((f) => f.id === meal.freezer_item_id) : undefined}
            busy={busySlot === `${day.date}|${slot}`}
            onUpdate={(patch) => onUpdate(slot, patch)}
            onFreeze={() => onFreeze(meal)}
            onSaveRecipe={() => onSaveRecipe(meal)}
            onOpen={() => onOpen(slot)}
          />
        )
      })}
    </div>
  )
}

// ── Meal card ──────────────────────────────────────────────────────────────────

function MealCard({
  slot, meal, lunchKind, freezerItem, busy, onUpdate, onFreeze, onSaveRecipe, onOpen,
}: {
  slot: SlotKey
  meal: PlannedMeal
  lunchKind?: string
  freezerItem?: FreezerItem
  busy: boolean
  onUpdate: (patch: Partial<PlannedMeal>) => void
  onFreeze: () => void
  onSaveRecipe: () => void
  onOpen: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(meal.title)
  const isSchool = slot === "lunchbox" && meal.title === SCHOOL_LUNCH_TITLE
  const isDinner = slot === "dinner"
  const style    = SLOT_STYLES[slot]
  const Icon     = style.icon
  const optionCount = meal.alternatives?.length ?? 0

  function saveEdit() {
    const t = draft.trim()
    if (t && t !== meal.title) {
      // A hand-typed meal: keep it locked, and drop AI details that no longer apply
      onUpdate({ title: t, locked: true, source: "fresh", ingredients: [], freezer_item_id: null, freezer_portions: null, recipe: null })
    }
    setEditing(false)
  }

  return (
    <div className={cn("rounded-2xl border px-3 py-2.5 flex flex-col gap-1.5 transition-colors", style.filled, busy && "opacity-60")}>
      <div className="flex items-center gap-1.5">
        <span className={cn("flex size-6 items-center justify-center rounded-lg", style.badge)}>
          <Icon className="size-3.5" />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] opacity-80 truncate">
          {SLOT_LABELS[slot]}
          {slot === "lunchbox" && lunchKind && !isSchool && ` · ${LUNCH_KIND_LABELS[lunchKind as keyof typeof LUNCH_KIND_LABELS]}`}
        </span>
        {!isSchool && (
          <div className="ml-auto flex items-center -mr-1">
            {busy && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
            <IconBtn label={meal.locked ? "Unlock" : "Lock"} onPrimary={isDinner} onClick={() => onUpdate({ locked: !meal.locked })}>
              {meal.locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
            </IconBtn>
            <IconBtn label="Type your own" onPrimary={isDinner} onClick={() => { setDraft(meal.title); setEditing(true) }}>
              <Pencil className="size-3.5" />
            </IconBtn>
          </div>
        )}
      </div>

      {editing ? (
        <div className="flex items-center gap-1.5">
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(false) }}
            className="h-9 text-[14px] bg-background text-foreground"
          />
          <IconBtn label="Save" onPrimary={isDinner} onClick={saveEdit}><Check className="size-4" /></IconBtn>
          <IconBtn label="Cancel" onPrimary={isDinner} onClick={() => setEditing(false)}><X className="size-4" /></IconBtn>
        </div>
      ) : isSchool ? (
        <p className="font-semibold leading-snug text-[15px]">{meal.title}</p>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          title="See recipe and options"
          className="text-left font-semibold leading-snug text-[15px] break-words underline-offset-4 decoration-1 hover:underline"
        >
          {meal.title}
        </button>
      )}

      {!isSchool && (
        <div className="flex flex-wrap gap-1">
          {meal.source && meal.source !== "fresh" && (
            <Chip onPrimary={isDinner}>
              {meal.source === "cook_morning" && <Sunrise className="size-3" />}
              {meal.source === "freezer" && <Snowflake className="size-3" />}
              {SOURCE_LABELS[meal.source]}
              {meal.source === "freezer" && meal.freezer_portions ? ` · ${meal.freezer_portions}` : ""}
            </Chip>
          )}
          {meal.cook_minutes ? (
            <Chip onPrimary={isDinner}><Clock className="size-3" />{meal.cook_minutes} min{meal.effort ? ` · ${meal.effort}` : ""}</Chip>
          ) : null}
          {meal.extra_for_lunchbox && <Chip onPrimary={isDinner}>Make extra for lunchboxes</Chip>}
          {meal.freeze_portions ? <Chip onPrimary={isDinner}>Cook double · freeze {meal.freeze_portions}</Chip> : null}
          {meal.source === "freezer" && !freezerItem && <Chip onPrimary={isDinner}>Not in freezer any more</Chip>}
        </div>
      )}

      {meal.notes && !isSchool && (
        <p className="text-[12.5px] leading-snug opacity-80">{meal.notes}</p>
      )}

      {!isSchool && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <SmallAction onPrimary={isDinner} onClick={onOpen}>
            <BookOpen className="size-3" /> Recipe{optionCount > 0 ? ` · ${optionCount + 1} options` : " · options"}
          </SmallAction>
          {isDinner && meal.freeze_portions && !meal.frozen_done ? (
            <SmallAction onPrimary={isDinner} onClick={onFreeze}><Snowflake className="size-3" /> Add {meal.freeze_portions} to freezer</SmallAction>
          ) : null}
          {isDinner && meal.frozen_done && (
            <span className="flex items-center gap-1 text-[12px] font-semibold opacity-80"><CircleCheck className="size-3" /> Frozen</span>
          )}
          {meal.recipe && (
            <SmallAction onPrimary={isDinner} onClick={onSaveRecipe}><BookmarkPlus className="size-3" /> Save</SmallAction>
          )}
        </div>
      )}
    </div>
  )
}

function IconBtn({ children, label, onClick, disabled, onPrimary }: {
  children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; onPrimary?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex size-8 items-center justify-center rounded-lg transition-colors disabled:opacity-40",
        onPrimary ? "hover:bg-white/15" : "opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10",
      )}
    >
      {children}
    </button>
  )
}

function Chip({ children, onPrimary }: { children: React.ReactNode; onPrimary?: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium",
      onPrimary ? "bg-white/15" : "bg-black/5 dark:bg-white/10",
    )}>
      {children}
    </span>
  )
}

function SmallAction({ children, onClick, onPrimary }: { children: React.ReactNode; onClick: () => void; onPrimary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold transition-colors",
        onPrimary ? "bg-white/15 hover:bg-white/25" : "bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15",
      )}
    >
      {children}
    </button>
  )
}
