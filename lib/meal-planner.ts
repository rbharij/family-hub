// ── Meal planner: shared types and helpers (safe for client and server) ──────

export type LunchKind = "hot" | "cold" | "school" | "none"
export type Effort = "easy" | "medium" | "ambitious"

/**
 * fresh        cook from scratch at the usual time
 * cook_morning cook in the morning (or slow cooker) because the evening is busy
 * freezer      reheat a portion from the freezer inventory
 * batch        uses a portion made in this week's batch cook session
 * leftovers    leftovers from an earlier meal
 * variation    a twist on an earlier dinner (leftovers plus a few extras)
 * favourite    a fixed favourite slot
 */
export type MealSource = "fresh" | "cook_morning" | "freezer" | "batch" | "leftovers" | "variation" | "favourite"

export type Protein =
  | "chicken" | "beef" | "pork" | "lamb" | "fish" | "seafood" | "vegetarian" | "vegan" | "eggs" | "mixed"

export const PROTEINS: Protein[] = ["chicken", "beef", "pork", "lamb", "fish", "seafood", "vegetarian", "vegan", "eggs", "mixed"]

export const PROTEIN_LABELS: Record<Protein, string> = {
  chicken: "Chicken", beef: "Beef", pork: "Pork", lamb: "Lamb", fish: "Fish", seafood: "Seafood",
  vegetarian: "Vegetarian", vegan: "Vegan", eggs: "Eggs", mixed: "Mixed",
}

/** Meat-free proteins count towards the vegetarian target */
export const MEAT_FREE: Protein[] = ["vegetarian", "vegan", "eggs"]

/** Which dinner a lunchbox or car dinner is made from */
export type BasedOn = "same_day" | "previous_day"

export interface Ingredient {
  name: string
  qty?: string | null
}

export interface PlannedMeal {
  title: string
  notes?: string | null
  source?: MealSource
  cook_minutes?: number | null
  effort?: Effort | null
  ingredients?: Ingredient[]
  /** Freezer item used (source = freezer) */
  freezer_item_id?: string | null
  freezer_portions?: number | null
  /** Main protein, used to keep the week balanced */
  protein?: Protein | null
  /** Lunchbox / car dinner: made from that day's or the previous day's dinner */
  based_on?: BasedOn | null
  /** Dinner: cook enough extra for the next school day's lunchbox */
  extra_for_lunchbox?: boolean
  /** Dinner: cook an extra portion for that day's car dinner */
  extra_for_car_dinner?: boolean
  /** Dinner: cook a double batch and freeze this many portions */
  freeze_portions?: number | null
  /** Set when the family has locked this meal so regenerations keep it */
  locked?: boolean
  /** Set after "Add to freezer" has been pressed for freeze_portions */
  frozen_done?: boolean
  /** Full recipe, written on demand when the meal is opened (cached here) */
  recipe?: RecipeDetail | null
  /** Other options for this slot; the family can pick one instead */
  alternatives?: PlannedMeal[]
  /** An alternative whose ingredients still need filling in when chosen */
  incomplete?: boolean
}

export interface RecipeDetail {
  serves: number
  prep_minutes: number | null
  cook_minutes: number | null
  effort: Effort | null
  /** Every ingredient, including store-cupboard items */
  ingredients: Ingredient[]
  steps: string[]
  tips?: string[]
  /** Short summary of what makes it easy or hard */
  effort_note?: string | null
}

export interface PlannedLunchbox extends PlannedMeal {
  kind: LunchKind
}

export interface PlanDay {
  date: string               // YYYY-MM-DD
  day_note?: string | null   // e.g. "Busy from 5pm: cook in the morning"
  dinner: PlannedMeal | null
  lunch: PlannedMeal | null
  lunchbox: PlannedLunchbox | null
  car_dinner: PlannedMeal | null
}

export interface BatchDish {
  title: string
  portions_to_freeze: number
  ingredients?: Ingredient[]
}

export interface BatchSession {
  date: string
  notes?: string | null
  dishes: BatchDish[]
  done?: boolean
}

export interface WeekPlan {
  summary?: string | null
  days: PlanDay[]
  batch_session: BatchSession | null
}

export interface MealPlanRow {
  id: string
  week_start: string
  status: "draft" | "confirmed"
  plan: WeekPlan
  freezer_deductions: { freezer_item_id: string; portions: number }[]
  source: "manual" | "auto"
  created_at: string
  updated_at: string
  confirmed_at: string | null
}

export interface PlannerSettings {
  id: string
  lunch_pattern: Record<string, LunchKind>
  car_dinner_days: number[]
  car_dinner_member_id: string | null
  lunch_days: number[]
  favourite_slots: { day: number; title: string }[]
  /** Minimum meat-free dinners a week (column may be missing before the migration) */
  veg_dinners_per_week?: number | null
  /** No single meat more than this many dinners a week */
  max_same_protein?: number | null
  household_notes: string | null
  auto_draft: boolean
}

export interface FreezerItem {
  id: string
  dish: string
  portions: number
  frozen_on: string
  notes: string | null
  created_at: string
}

export type SlotKey = "dinner" | "lunch" | "lunchbox" | "car_dinner"

export const SLOT_LABELS: Record<SlotKey, string> = {
  dinner: "Dinner",
  lunch: "Lunch",
  lunchbox: "Lunchbox",
  car_dinner: "Car dinner",
}

export const LUNCH_KIND_LABELS: Record<LunchKind, string> = {
  hot: "Hot (food flask)",
  cold: "Cold",
  school: "School lunch",
  none: "No lunchbox",
}

export const SOURCE_LABELS: Record<MealSource, string> = {
  fresh: "Cook fresh",
  cook_morning: "Cook in the morning",
  freezer: "From the freezer",
  batch: "From batch cook",
  leftovers: "Leftovers",
  variation: "Twist on dinner",
  favourite: "Favourite",
}

export const SCHOOL_LUNCH_TITLE = "School Lunch"

// ── Date helpers (string based, timezone safe) ──────────────────────────────

export function addDaysStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}

/** 0 = Mon … 6 = Sun */
export function weekdayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i))
}

/** Days since a date string, relative to `today` (YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(...(from.split("-").map(Number) as [number, number, number]))
  const b = Date.UTC(...(to.split("-").map(Number) as [number, number, number]))
  return Math.round((b - a) / 86_400_000)
}

// ── Shopping list (deterministic, built from ingredients) ───────────────────

export interface ShoppingLine { name: string; qty: string | null }

function normaliseName(n: string): string {
  return n.trim().toLowerCase().replace(/\s+/g, " ")
}

function collectMeal(meal: PlannedMeal | null | undefined, out: Ingredient[]) {
  if (!meal) return
  // Variations list only the extra ingredients, so they are included
  if (meal.source === "freezer" || meal.source === "batch" || meal.source === "leftovers") return
  for (const ing of meal.ingredients ?? []) out.push(ing)
}

export function buildShoppingList(plan: WeekPlan): ShoppingLine[] {
  const all: Ingredient[] = []
  for (const day of plan.days) {
    collectMeal(day.dinner, all)
    collectMeal(day.lunch, all)
    if (day.lunchbox && day.lunchbox.kind !== "school" && day.lunchbox.kind !== "none") {
      collectMeal(day.lunchbox, all)
    }
    collectMeal(day.car_dinner, all)
  }
  for (const dish of plan.batch_session?.dishes ?? []) {
    for (const ing of dish.ingredients ?? []) all.push(ing)
  }

  const merged = new Map<string, { name: string; qtys: string[] }>()
  for (const ing of all) {
    if (!ing?.name?.trim()) continue
    const key = normaliseName(ing.name)
    const entry = merged.get(key) ?? { name: ing.name.trim(), qtys: [] }
    if (ing.qty && ing.qty.trim()) entry.qtys.push(ing.qty.trim())
    merged.set(key, entry)
  }

  return Array.from(merged.values())
    .map((e) => ({ name: e.name, qty: e.qtys.length ? e.qtys.join(" + ") : null }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function shoppingItemLabel(line: ShoppingLine): string {
  return line.qty ? `${line.name} (${line.qty})` : line.name
}

// ── Freezer age helper ──────────────────────────────────────────────────────

/** Items frozen longer than this are flagged to use first. */
export const FREEZER_OLD_DAYS = 60

// ── Week balance (protein variety, vegetarian target, freezer use) ──────────

export const DEFAULT_VEG_DINNERS = 2
export const DEFAULT_MAX_SAME_PROTEIN = 2

export interface WeekBalance {
  counts: { protein: Protein; count: number }[]
  meatFree: number
  vegTarget: number
  maxSame: number
  warnings: string[]
}

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

export function weekBalance(
  plan: WeekPlan,
  opts: { vegTarget?: number | null; maxSame?: number | null; freezerHasItems?: boolean } = {},
): WeekBalance {
  const vegTarget = opts.vegTarget ?? DEFAULT_VEG_DINNERS
  const maxSame   = opts.maxSame ?? DEFAULT_MAX_SAME_PROTEIN
  const dinners   = plan.days.map((d) => d.dinner)

  const tally = new Map<Protein, number>()
  for (const m of dinners) if (m?.protein) tally.set(m.protein, (tally.get(m.protein) ?? 0) + 1)
  const counts = Array.from(tally.entries())
    .map(([protein, count]) => ({ protein, count }))
    .sort((a, b) => b.count - a.count)
  const meatFree = dinners.filter((m) => m?.protein && MEAT_FREE.includes(m.protein)).length

  const warnings: string[] = []
  const known = dinners.filter((m) => m?.protein).length
  if (known > 0 && meatFree < vegTarget) {
    warnings.push(`Only ${meatFree} vegetarian dinner${meatFree === 1 ? "" : "s"} (aim ${vegTarget})`)
  }
  for (const { protein, count } of counts) {
    if (!MEAT_FREE.includes(protein) && protein !== "mixed" && count > maxSame) {
      warnings.push(`${PROTEIN_LABELS[protein]} ${count} times (max ${maxSame})`)
    }
  }
  for (let i = 1; i < dinners.length; i++) {
    const a = dinners[i - 1]?.protein, b = dinners[i]?.protein
    if (a && b && a === b && !MEAT_FREE.includes(a) && a !== "mixed") {
      warnings.push(`${PROTEIN_LABELS[a]} two nights running (${DAY_SHORT[i - 1]} and ${DAY_SHORT[i]})`)
    }
  }
  plan.days.forEach((d, i) => {
    if (i >= 5) {
      for (const slot of ["dinner", "lunch", "car_dinner"] as SlotKey[]) {
        if (d[slot]?.source === "freezer") warnings.push(`Freezer meal at the weekend (${DAY_SHORT[i]})`)
      }
    }
  })
  if (opts.freezerHasItems) {
    const usesFreezer = plan.days.slice(0, 5).some((d) => (["dinner", "car_dinner"] as SlotKey[]).some((s) => d[s]?.source === "freezer"))
    if (!usesFreezer) warnings.push("Nothing from the freezer on a weekday")
  }
  return { counts, meatFree, vegTarget, maxSame, warnings }
}

// ── Links between dinners and the meals made from them ─────────────────────

function addDays(dateStr: string, n: number) { return addDaysStr(dateStr, n) }

/**
 * Works out which dinner each lunchbox / car dinner is made from, and sets
 * the "make extra" flags on those dinners to match. Run after any change.
 */
export function linkDinnerFlags(plan: WeekPlan): WeekPlan {
  const days = plan.days.map((d) => ({
    ...d,
    dinner: d.dinner ? { ...d.dinner, extra_for_lunchbox: false, extra_for_car_dinner: false } : null,
    lunchbox: d.lunchbox ? { ...d.lunchbox } : null,
    car_dinner: d.car_dinner ? { ...d.car_dinner } : null,
  }))
  const derived = (m: PlannedMeal | null | undefined) => m?.source === "leftovers" || m?.source === "variation"

  days.forEach((d, i) => {
    const lb = d.lunchbox
    if (lb && (lb.kind === "hot" || lb.kind === "cold")) {
      if (!lb.based_on && derived(lb)) lb.based_on = "previous_day"
      if (lb.based_on === "same_day") lb.based_on = "previous_day" // lunch is eaten before that day's dinner
      if (lb.based_on === "previous_day" && i > 0 && days[i - 1].dinner) days[i - 1].dinner!.extra_for_lunchbox = true
    }
    const car = d.car_dinner
    if (car) {
      if (!car.based_on && derived(car)) car.based_on = "same_day"
      if (car.based_on === "same_day" && d.dinner) d.dinner.extra_for_car_dinner = true
      if (car.based_on === "previous_day" && i > 0 && days[i - 1].dinner) days[i - 1].dinner!.extra_for_car_dinner = true
    }
  })
  return { ...plan, days }
}

/** Meals that are made from the dinner on `dinnerDate` (and are not locked). */
export function dependentsOf(plan: WeekPlan, dinnerDate: string): { date: string; slot: "lunchbox" | "car_dinner" }[] {
  const next  = addDays(dinnerDate, 1)
  const today = plan.days.find((d) => d.date === dinnerDate)
  const tomo  = plan.days.find((d) => d.date === next)
  const out: { date: string; slot: "lunchbox" | "car_dinner" }[] = []
  const lb = tomo?.lunchbox
  if (lb && !lb.locked && (lb.kind === "hot" || lb.kind === "cold") && lb.based_on === "previous_day") out.push({ date: next, slot: "lunchbox" })
  if (today?.car_dinner && !today.car_dinner.locked && today.car_dinner.based_on === "same_day") out.push({ date: dinnerDate, slot: "car_dinner" })
  if (tomo?.car_dinner && !tomo.car_dinner.locked && tomo.car_dinner.based_on === "previous_day") out.push({ date: next, slot: "car_dinner" })
  return out
}

/** The dinner a lunchbox / car dinner is made from, if any. */
export function sourceDinnerDate(date: string, meal: PlannedMeal | null | undefined): string | null {
  if (!meal?.based_on) return null
  return meal.based_on === "same_day" ? date : addDaysStr(date, -1)
}
