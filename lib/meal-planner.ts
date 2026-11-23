// ── Meal planner: shared types and helpers (safe for client and server) ──────

export type LunchKind = "hot" | "cold" | "school" | "none"
export type Effort = "easy" | "medium" | "ambitious"

/**
 * fresh        cook from scratch at the usual time
 * cook_morning cook in the morning (or slow cooker) because the evening is busy
 * freezer      reheat a portion from the freezer inventory
 * batch        uses a portion made in this week's batch cook session
 * leftovers    leftovers from an earlier meal
 * favourite    a fixed favourite slot
 */
export type MealSource = "fresh" | "cook_morning" | "freezer" | "batch" | "leftovers" | "favourite"

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
  /** Dinner: cook enough extra for the next school day's lunchbox */
  extra_for_lunchbox?: boolean
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
