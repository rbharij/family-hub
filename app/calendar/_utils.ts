// ── Types ─────────────────────────────────────────────────────────────────────

export interface CalEvent {
  id: string
  title: string
  description: string | null
  location: string | null
  start_at: string
  end_at: string | null
  is_all_day: boolean
  color: string | null
  google_event_id: string | null
  google_origin?: boolean
  updated_at?: string
}

export interface LayoutEvent {
  event: CalEvent
  startCol: number // 0–6 within the week row
  endCol: number   // 0–6 within the week row
  track: number    // vertical slot (0 = topmost)
}

// ── Date primitives ───────────────────────────────────────────────────────────

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** Whole-day difference: how many days later is `b` compared to `a` */
export function dayDiff(b: Date, a: Date): number {
  return Math.round(
    (startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000,
  )
}

// ── Calendar grid ─────────────────────────────────────────────────────────────

/**
 * Returns an array of weeks (each week = 7 Date objects).
 * Grid is Monday-based and always starts on the Monday on/before the 1st of
 * the month, ending on the Sunday on/after the last day of the month.
 */
export function buildCalendarGrid(year: number, month: number): Date[][] {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)

  // Mon=0 … Sun=6
  const startOffset = (firstDay.getDay() + 6) % 7
  const endOffset = (lastDay.getDay() + 6) % 7

  const gridStart = addDays(firstDay, -startOffset)
  const gridEnd = addDays(lastDay, 6 - endOffset)

  const weeks: Date[][] = []
  let cur = new Date(gridStart)

  while (cur <= gridEnd) {
    const week: Date[] = []
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cur))
      cur = addDays(cur, 1)
    }
    weeks.push(week)
  }

  return weeks
}

// ── Event layout ──────────────────────────────────────────────────────────────

/**
 * For a given week row, assigns each overlapping event a horizontal span
 * (startCol/endCol) and a vertical track so events never overlap.
 * Longer/earlier events get lower track numbers (appear higher).
 */
export function layoutWeekEvents(
  events: CalEvent[],
  weekDays: Date[],
): LayoutEvent[] {
  const weekStart = startOfDay(weekDays[0])
  const weekEnd = startOfDay(weekDays[6])

  const sorted = events
    .map((event) => {
      const eStart = startOfDay(new Date(event.start_at))
      const eEnd = event.end_at
        ? startOfDay(new Date(event.end_at))
        : eStart
      return { event, eStart, eEnd }
    })
    .filter(({ eStart, eEnd }) => eStart <= weekEnd && eEnd >= weekStart)
    .sort((a, b) => {
      // Longer spans first; ties broken by earlier start
      const diff =
        dayDiff(b.eEnd, b.eStart) - dayDiff(a.eEnd, a.eStart)
      return diff !== 0 ? diff : a.eStart.getTime() - b.eStart.getTime()
    })

  // Track occupancy: occupied[track][col] = true if taken
  const occupied: boolean[][] = []
  const result: LayoutEvent[] = []

  for (const { event, eStart, eEnd } of sorted) {
    const startCol = Math.max(0, dayDiff(eStart, weekStart))
    const endCol = Math.min(6, dayDiff(eEnd, weekStart))

    let track = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (!occupied[track]) occupied[track] = new Array(7).fill(false)

      let fits = true
      for (let c = startCol; c <= endCol; c++) {
        if (occupied[track][c]) {
          fits = false
          break
        }
      }

      if (fits) {
        for (let c = startCol; c <= endCol; c++) occupied[track][c] = true
        result.push({ event, startCol, endCol, track })
        break
      }
      track++
    }
  }

  return result
}

// ── Colour helpers ────────────────────────────────────────────────────────────

/** Returns #111827 or #ffffff depending on perceived luminance of a hex colour. */
export function chipTextColor(hex: string | null): string {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return "#ffffff"
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? "#111827" : "#ffffff"
}
