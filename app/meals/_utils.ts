export type MealType = "dinner" | "lunch" | "lunchbox"

export interface Meal {
  id: string
  date: string            // "YYYY-MM-DD"
  meal_type: MealType
  title: string
  notes: string | null
  for_member_id: string | null  // set for per-child lunchbox rows
  created_at: string
}

export interface FamilyMember {
  id: string
  name: string
  avatar_emoji: string | null
  color: string | null
  is_child: boolean
}

// ── Week helpers ───────────────────────────────────────────────────────────────

export function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const offset = (day + 6) % 7  // Mon=0
  const monday = new Date(d)
  monday.setDate(d.getDate() - offset)
  monday.setHours(0, 0, 0, 0)
  return monday
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export function toDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function weekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
export const DAY_FULL   = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

export const MEAL_TYPES: MealType[] = ["dinner", "lunch", "lunchbox"]

export const MEAL_LABELS: Record<MealType, string> = {
  dinner:   "Dinner",
  lunch:    "Lunch",
  lunchbox: "Lunchbox",
}

export const MEAL_PLACEHOLDERS: Record<MealType, string> = {
  dinner:   "Add dinner…",
  lunch:    "Add lunch…",
  lunchbox: "Add lunchbox…",
}

export const MEAL_EMOJIS: Record<MealType, string> = {
  dinner:   "🍽️",
  lunch:    "🥗",
  lunchbox: "🥪",
}
