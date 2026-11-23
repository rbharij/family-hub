import { Soup, Salad, Backpack, Car, type LucideIcon } from "lucide-react"

/**
 * One visual language for each kind of meal, shared by the Meals page,
 * the planner and anywhere else meals are shown.
 */
export type SlotKind = "dinner" | "lunch" | "lunchbox" | "car_dinner"

export interface SlotStyle {
  label: string
  icon: LucideIcon
  /** Filled card */
  filled: string
  /** Icon badge on a filled card */
  badge: string
  /** Empty "add" card */
  empty: string
  /** Row label chip */
  chip: string
}

export const SLOT_STYLES: Record<SlotKind, SlotStyle> = {
  dinner: {
    label: "Dinner",
    icon: Soup,
    filled: "bg-primary text-primary-foreground border-primary hover:bg-primary/90",
    badge: "bg-white/15 text-primary-foreground",
    empty: "border-primary/30 text-primary/70 hover:bg-primary/5",
    chip: "bg-primary text-primary-foreground",
  },
  lunch: {
    label: "Lunch",
    icon: Salad,
    filled: "bg-amber-50 text-amber-950 border-amber-200 hover:border-amber-400 dark:bg-amber-950/30 dark:text-amber-50 dark:border-amber-800/60",
    badge: "bg-amber-200/70 text-amber-900 dark:bg-amber-800/50 dark:text-amber-100",
    empty: "border-amber-300/70 text-amber-700/80 hover:bg-amber-50 dark:border-amber-800/60 dark:text-amber-300/80 dark:hover:bg-amber-950/30",
    chip: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100",
  },
  lunchbox: {
    label: "Lunchbox",
    icon: Backpack,
    filled: "bg-emerald-50 text-emerald-950 border-emerald-200 hover:border-emerald-400 dark:bg-emerald-950/30 dark:text-emerald-50 dark:border-emerald-800/60",
    badge: "bg-emerald-200/70 text-emerald-900 dark:bg-emerald-800/50 dark:text-emerald-100",
    empty: "border-emerald-300/70 text-emerald-700/80 hover:bg-emerald-50 dark:border-emerald-800/60 dark:text-emerald-300/80 dark:hover:bg-emerald-950/30",
    chip: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100",
  },
  car_dinner: {
    label: "Car dinner",
    icon: Car,
    filled: "bg-sky-50 text-sky-950 border-sky-200 hover:border-sky-400 dark:bg-sky-950/30 dark:text-sky-50 dark:border-sky-800/60",
    badge: "bg-sky-200/70 text-sky-900 dark:bg-sky-800/50 dark:text-sky-100",
    empty: "border-sky-300/70 text-sky-700/80 hover:bg-sky-50 dark:border-sky-800/60 dark:text-sky-300/80 dark:hover:bg-sky-950/30",
    chip: "bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100",
  },
}
