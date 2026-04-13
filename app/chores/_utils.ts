// ── Types ──────────────────────────────────────────────────────────────────────

export interface FamilyMember {
  id: string
  name: string
  avatar_emoji: string | null
  color: string | null
}

export interface Chore {
  id: string
  title: string
  assigned_to: string | null
  due_date: string | null          // "YYYY-MM-DD"
  completed: boolean
  completed_at: string | null
  pocket_money_value: number
  is_recurring: boolean
  recur_days: number[] | null      // 0=Sun … 6=Sat
  recur_series_id: string | null   // groups all instances of a recurring series
}

// ── Week helpers ───────────────────────────────────────────────────────────────

/** Returns the Monday of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const day = d.getDay()           // 0=Sun…6=Sat
  const offset = (day + 6) % 7    // Mon=0
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

/** "YYYY-MM-DD" */
export function toDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Returns 7 Date objects for the week starting at `monday`. */
export function weekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

// ── Recurring expansion ────────────────────────────────────────────────────────

/**
 * Given a recurring chore spec, generate the list of due_date strings
 * for the current + next 7 weeks (8 weeks total) for the selected recur_days.
 * recur_days uses JS convention: 0=Sun, 1=Mon … 6=Sat.
 */
export function expandRecurringDates(recur_days: number[], weeks = 8): string[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const monday = startOfWeek(today)
  const dates: string[] = []

  for (let week = 0; week < weeks; week++) {
    for (const jsDay of recur_days) {
      // Convert JS day (0=Sun) to Mon-based offset
      const offset = jsDay === 0 ? 6 : jsDay - 1
      const date = addDays(monday, week * 7 + offset)
      // Only include dates from today onward
      if (date >= today) dates.push(toDateStr(date))
    }
  }

  return dates
}

// ── Display ────────────────────────────────────────────────────────────────────

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** JS getDay() values for Mon–Sun order */
export const WEEKDAY_JS_DAYS = [1, 2, 3, 4, 5, 6, 0]
