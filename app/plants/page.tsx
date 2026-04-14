"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Plus, Leaf } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase"
import { useRealtimeChannel } from "@/lib/use-realtime"
import { PlantPicker, type Plant } from "./_plant-picker"

// ── Helpers ────────────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, "0") }

function getWeekStart(d: Date): string {
  const day = d.getDay()
  const offset = (day + 6) % 7  // Mon = 0
  const monday = new Date(d)
  monday.setDate(d.getDate() - offset)
  monday.setHours(0, 0, 0, 0)
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`
}

function addWeeks(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00")
  d.setDate(d.getDate() + n * 7)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function weekLabel(weekStart: string): string {
  const start = new Date(weekStart + "T00:00:00")
  const end   = new Date(weekStart + "T00:00:00")
  end.setDate(end.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }
  return `${start.toLocaleDateString("en-AU", opts)} – ${end.toLocaleDateString("en-AU", opts)}, ${end.getFullYear()}`
}

const CATEGORY_COLORS: Record<string, string> = {
  vegetable: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  fruit:     "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  herb:      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  spice:     "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  nut:       "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  seed:      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  legume:    "bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-300",
  grain:     "bg-stone-100 text-stone-800 dark:bg-stone-900/40 dark:text-stone-300",
  other:     "bg-slate-100 text-slate-800 dark:bg-slate-900/40 dark:text-slate-300",
}

const CATEGORY_LABELS: Record<string, string> = {
  vegetable: "🥦 Vegetables",
  fruit:     "🍎 Fruits",
  herb:      "🌿 Herbs",
  spice:     "🌶️ Spices",
  nut:       "🌰 Nuts",
  seed:      "🌱 Seeds",
  legume:    "🫘 Legumes",
  grain:     "🌾 Grains",
  other:     "✨ Other",
}

const ALL_CATEGORIES = ["vegetable","fruit","herb","spice","nut","seed","legume","grain","other"]

const PLANT_TABLES = [{ table: "plants" }, { table: "weekly_plants" }] as const

const GOAL = 30

// ── Types ──────────────────────────────────────────────────────────────────────

interface WeeklyPlant {
  id: string
  plant_id: string
  week_start: string
  added_by: string
  meal_id: string | null
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function PlantsPage() {
  const todayWeekStart = getWeekStart(new Date())

  const [weekStart, setWeekStart] = useState(todayWeekStart)
  const [library, setLibrary]     = useState<Plant[]>([])
  const [weeklyPlants, setWeeklyPlants] = useState<WeeklyPlant[]>([])
  const [loading, setLoading]     = useState(true)
  const [logOpen, setLogOpen]     = useState(false)
  const [logSelected, setLogSelected] = useState<Plant[]>([])
  const [logging, setLogging]     = useState(false)
  const [newDiscoveries, setNewDiscoveries] = useState<Set<string>>(new Set())
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)

  const supabase = useRef(createClient()).current
  const isCurrentWeek = weekStart === todayWeekStart

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchLibrary = useCallback(async () => {
    const { data } = await supabase
      .from("plants")
      .select("id, name, emoji, category, times_eaten, first_eaten_date")
      .order("name")
    setLibrary((data ?? []) as Plant[])
  }, [supabase])

  const fetchWeeklyPlants = useCallback(async () => {
    const { data } = await supabase
      .from("weekly_plants")
      .select("id, plant_id, week_start, added_by, meal_id")
      .eq("week_start", weekStart)
    setWeeklyPlants(data ?? [])
    setLoading(false)
  }, [supabase, weekStart])

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchLibrary(), fetchWeeklyPlants()])
  }, [fetchLibrary, fetchWeeklyPlants])

  useRealtimeChannel(supabase, `plants-${weekStart}`, PLANT_TABLES, () => {
    fetchLibrary()
    fetchWeeklyPlants()
  })

  // ── Derived ────────────────────────────────────────────────────────────────

  const loggedPlantIds = new Set(weeklyPlants.map((wp) => wp.plant_id))
  const loggedPlants   = library.filter((p) => loggedPlantIds.has(p.id))
  const count          = loggedPlants.length
  const pct            = Math.min(100, Math.round((count / GOAL) * 100))
  const goalReached    = count >= GOAL

  const filteredLibrary = categoryFilter
    ? library.filter((p) => p.category === categoryFilter)
    : library

  // ── Log handler ────────────────────────────────────────────────────────────

  async function logPlants(plants: Plant[]) {
    if (plants.length === 0) return
    setLogging(true)
    const discoveries: string[] = []

    for (const plant of plants) {
      const { data } = await supabase.rpc("log_plant_for_week", {
        p_plant_id:   plant.id,
        p_week_start: weekStart,
        p_added_by:   "manual",
        p_meal_id:    null,
      })
      if (data && (data as { was_new_discovery: boolean }).was_new_discovery) {
        discoveries.push(plant.id)
      }
    }

    if (discoveries.length > 0) {
      setNewDiscoveries((prev) => new Set([...Array.from(prev), ...discoveries]))
    }

    await fetchLibrary()
    await fetchWeeklyPlants()
    setLogging(false)
    setLogOpen(false)
    setLogSelected([])

    const newCount = count + plants.filter((p) => !loggedPlantIds.has(p.id)).length
    if (newCount >= GOAL && count < GOAL) {
      toast.success("🎉 30 plant goal reached this week!")
    } else if (discoveries.length > 0) {
      toast.success(`🎉 New discovery! First time eating ${plants.find((p) => discoveries.includes(p.id))?.name ?? "that plant"}`)
    } else {
      toast.success(`Added ${plants.length} plant${plants.length > 1 ? "s" : ""} to this week`)
    }
  }

  async function quickLogPlant(plant: Plant) {
    if (loggedPlantIds.has(plant.id)) {
      toast.info(`${plant.emoji ?? "🌿"} ${plant.name} already logged this week`)
      return
    }
    await logPlants([plant])
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col lg:h-full p-3 lg:p-4 gap-4 max-w-5xl mx-auto w-full">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <Button variant="outline" size="icon" className="h-8 w-8"
          onClick={() => setWeekStart((w) => addWeeks(w, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8"
          onClick={() => setWeekStart((w) => addWeeks(w, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold truncate">{weekLabel(weekStart)}</h2>
        </div>
        {!isCurrentWeek && (
          <Button variant="outline" size="sm" className="h-8"
            onClick={() => setWeekStart(todayWeekStart)}>
            This week
          </Button>
        )}
      </div>

      {/* ── Progress ──────────────────────────────────────────────────────── */}
      <div className="shrink-0 rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Leaf className={cn("h-5 w-5", goalReached ? "text-green-500" : "text-muted-foreground")} />
            <span className="font-semibold text-sm">Plant diversity this week</span>
          </div>
          <span className={cn(
            "text-2xl font-black tabular-nums",
            goalReached ? "text-green-500" : "text-foreground",
          )}>
            {count}
            <span className="text-sm font-normal text-muted-foreground ml-1">/ {GOAL}</span>
          </span>
        </div>
        <div className="relative h-3 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              goalReached ? "bg-green-500" : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        {goalReached ? (
          <p className="text-sm font-medium text-green-600 dark:text-green-400">
            🎉 Goal reached! Keep going!
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {GOAL - count} more plant{GOAL - count !== 1 ? "s" : ""} to reach the weekly goal
          </p>
        )}
      </div>

      {/* ── This week's plants ────────────────────────────────────────────── */}
      <div className="shrink-0 rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">This week&apos;s plants</h3>
          <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setLogOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Log a plant
          </Button>
        </div>

        {loading ? (
          <div className="flex flex-wrap gap-2">
            {[1,2,3,4].map((i) => <Skeleton key={i} className="h-7 w-24 rounded-full" />)}
          </div>
        ) : loggedPlants.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No plants logged yet this week. Hit &quot;Log a plant&quot; to start! 🌱
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {loggedPlants.map((p) => {
              const isNew = newDiscoveries.has(p.id)
              return (
                <div key={p.id} className="relative">
                  <span className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium",
                    CATEGORY_COLORS[p.category] ?? CATEGORY_COLORS.other,
                  )}>
                    <span className="leading-none">{p.emoji ?? "🌿"}</span>
                    {p.name}
                  </span>
                  {isNew && (
                    <span className="absolute -top-2 -right-1 text-[10px] font-bold text-amber-500 whitespace-nowrap">
                      First! 🎉
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Library ───────────────────────────────────────────────────────── */}
      <div className="flex-1 rounded-xl border bg-card p-4 space-y-3 min-h-0 overflow-auto">
        <h3 className="font-semibold text-sm shrink-0">Plant library — tap to log</h3>

        {/* Category filters */}
        <div className="flex flex-wrap gap-1.5 shrink-0">
          <button
            onClick={() => setCategoryFilter(null)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
              !categoryFilter ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted",
            )}
          >
            All
          </button>
          {ALL_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat === categoryFilter ? null : cat)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                categoryFilter === cat ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted",
              )}
            >
              {CATEGORY_LABELS[cat]?.split(" ")[1] ?? cat}
            </button>
          ))}
        </div>

        {/* Plant grid */}
        <div className="flex flex-wrap gap-2">
          {filteredLibrary.map((p) => {
            const logged = loggedPlantIds.has(p.id)
            return (
              <button
                key={p.id}
                onClick={() => quickLogPlant(p)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium border-2 transition-all",
                  logged
                    ? cn("border-transparent", CATEGORY_COLORS[p.category] ?? CATEGORY_COLORS.other)
                    : "border-border bg-background hover:border-primary/50 hover:bg-muted/50 text-muted-foreground",
                )}
              >
                <span className="leading-none">{p.emoji ?? "🌿"}</span>
                {p.name}
                {logged && <span className="text-[10px] opacity-70">✓</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Log dialog ────────────────────────────────────────────────────── */}
      <Dialog open={logOpen} onOpenChange={(o) => { setLogOpen(o); if (!o) setLogSelected([]) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">🌱 Log plants eaten</DialogTitle>
            <p className="text-xs text-muted-foreground">{weekLabel(weekStart)}</p>
          </DialogHeader>
          <div className="py-2">
            <PlantPicker
              selected={logSelected}
              onAdd={(p) => setLogSelected((prev) => prev.some((x) => x.id === p.id) ? prev : [...prev, p])}
              onRemove={(id) => setLogSelected((prev) => prev.filter((x) => x.id !== id))}
              label=""
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setLogOpen(false); setLogSelected([]) }}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => logPlants(logSelected)} disabled={logging || logSelected.length === 0}>
              {logging ? "Saving…" : `Log ${logSelected.length > 0 ? logSelected.length : ""} plant${logSelected.length !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── FAB (mobile) ──────────────────────────────────────────────────── */}
      <button
        onClick={() => setLogOpen(true)}
        className={cn(
          "fixed z-40 flex items-center justify-center w-14 h-14 rounded-full shadow-lg lg:hidden",
          "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all",
          "bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] right-5",
        )}
        aria-label="Log a plant"
      >
        <Plus className="h-6 w-6" />
      </button>
    </div>
  )
}
