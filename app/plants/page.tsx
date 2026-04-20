"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import confetti from "canvas-confetti"
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react"
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
import { MemberSelector, type FamilyMember } from "./_member-selector"
import { GrowingPlant } from "./_growing-plant"

// ── Helpers ────────────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, "0") }

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function getWeekStart(d: Date): string {
  const day = d.getDay()
  const offset = (day + 6) % 7
  const mon = new Date(d)
  mon.setDate(d.getDate() - offset)
  mon.setHours(0, 0, 0, 0)
  return `${mon.getFullYear()}-${pad(mon.getMonth() + 1)}-${pad(mon.getDate())}`
}

function addWeeks(s: string, n: number): string {
  const d = new Date(s + "T00:00:00")
  d.setDate(d.getDate() + n * 7)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function weekLabel(weekStart: string): string {
  const s = new Date(weekStart + "T00:00:00")
  const e = new Date(weekStart + "T00:00:00")
  e.setDate(e.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }
  return `${s.toLocaleDateString("en-AU", opts)} – ${e.toLocaleDateString("en-AU", opts)}, ${e.getFullYear()}`
}

const CATEGORY_COLORS: Record<string, string> = {
  vegetable: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  fruit:     "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  herb:      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  spice:     "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  nut:       "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  seed:      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  legume:    "bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-300",
  grain:     "bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
  other:     "bg-slate-100 text-slate-800 dark:bg-slate-900/40 dark:text-slate-300",
}

const CATEGORY_LABELS: Record<string, string> = {
  vegetable: "🥦 Vegetables", fruit: "🍎 Fruits", herb: "🌿 Herbs",
  spice: "🌶️ Spices", nut: "🌰 Nuts", seed: "🌱 Seeds",
  legume: "🫘 Legumes", grain: "🌾 Grains", other: "✨ Other",
}

const ALL_CATEGORIES = ["vegetable","fruit","herb","spice","nut","seed","legume","grain","other"]
const GOAL = 30
const FALLBACK_COLORS = ["#6366f1","#ec4899","#f59e0b","#14b8a6","#8b5cf6","#3b82f6"]

const PLANT_TABLES = [
  { table: "member_weekly_plants" },
  { table: "plants" },
  { table: "plant_discoveries" },
] as const

// ── Types ──────────────────────────────────────────────────────────────────────

interface MemberWeeklyPlant {
  plant_id:   string
  member_id:  string
  created_at: string
}

interface PlantDiscovery {
  plant_id:         string
  member_id:        string
  first_eaten_date: string
}

// ── Mini circular ring ────────────────────────────────────────────────────────

function MiniRing({ pct, color, size = 56 }: { pct: number; color: string; size?: number }) {
  const sw   = 5
  const r    = (size - sw) / 2
  const circ = 2 * Math.PI * r
  const off  = circ - (pct / 100) * circ
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor"
        strokeWidth={sw} className="opacity-10" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color}
        strokeWidth={sw} strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={off}
        style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
    </svg>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function PlantsPage() {
  const todayWeekStart = getWeekStart(new Date())

  const [weekStart, setWeekStart]       = useState(todayWeekStart)
  const [library, setLibrary]           = useState<Plant[]>([])
  const [members, setMembers]           = useState<FamilyMember[]>([])
  const [mwPlants, setMwPlants]         = useState<MemberWeeklyPlant[]>([])
  const [discoveries, setDiscoveries]   = useState<PlantDiscovery[]>([])
  const [loading, setLoading]           = useState(true)

  // Log dialog
  const [logOpen, setLogOpen]           = useState(false)
  const [logPlants, setLogPlants]       = useState<Plant[]>([])
  const [logMemberIds, setLogMemberIds] = useState<string[]>([])
  const [logShowError, setLogShowError] = useState(false)
  const [logging, setLogging]           = useState(false)

  // Add-plant-for-member button target
  const [logForMember, setLogForMember] = useState<FamilyMember | null>(null)

  const supabase            = useRef(createClient()).current
  const isCurrentWeek       = weekStart === todayWeekStart
  const firedMember         = useRef(new Set<string>())
  const firedFamily         = useRef(false)
  const deleteTimers        = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const pageRef             = useRef<HTMLDivElement>(null)

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    const [libRes, membersRes, mwRes, discRes] = await Promise.all([
      supabase.from("plants")
        .select("id, name, emoji, category, times_eaten, first_eaten_date")
        .order("name"),
      supabase.from("family_members")
        .select("id, name, avatar_emoji, color")
        .order("created_at"),
      supabase.from("member_weekly_plants")
        .select("plant_id, member_id, created_at")
        .eq("week_start", weekStart),
      supabase.from("plant_discoveries")
        .select("plant_id, member_id, first_eaten_date"),
    ])
    setLibrary((libRes.data ?? []) as Plant[])
    setMembers((membersRes.data ?? []) as FamilyMember[])
    setMwPlants((mwRes.data ?? []) as MemberWeeklyPlant[])
    setDiscoveries((discRes.data ?? []) as PlantDiscovery[])
    setLoading(false)
  }, [supabase, weekStart])

  useEffect(() => {
    setLoading(true)
    firedMember.current.clear()
    firedFamily.current = false
    fetchData()
    // Poll every 60 s; detect midnight so pending plants roll into confirmed
    let lastDate = toDateStr(new Date())
    const id = setInterval(() => {
      const now = toDateStr(new Date())
      if (now !== lastDate) {
        lastDate = now
        firedMember.current.clear()
        firedFamily.current = false
      }
      fetchData()
    }, 60_000)
    return () => clearInterval(id)
  }, [fetchData])

  useRealtimeChannel(supabase, `plants-${weekStart}`, PLANT_TABLES, fetchData)

  // ── Confetti ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (loading) return
    members.forEach((m, idx) => {
      const count = new Set(mwPlants.filter(w => w.member_id === m.id).map(w => w.plant_id)).size
      const key   = `${m.id}-${weekStart}`
      if (count >= GOAL && !firedMember.current.has(key)) {
        firedMember.current.add(key)
        const color = m.color ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length]
        confetti({ particleCount: 150, spread: 80, origin: { y: 0.55 },
          colors: [color, "#ffffff", "#fde68a"], zIndex: 9999 })
        toast.success(`🌱🎉 ${m.name} hit 30 plants this week!`)
      }
    })
    // Family goal = every member has hit 30
    const allDone = members.length > 0 && members.every(m =>
      new Set(mwPlants.filter(w => w.member_id === m.id).map(w => w.plant_id)).size >= GOAL
    )
    if (allDone && !firedFamily.current) {
      firedFamily.current = true
      setTimeout(() => {
        confetti({ particleCount: 200, spread: 100, origin: { y: 0.5 },
          colors: ["#22c55e", "#ffffff", "#fde68a"], zIndex: 9999 })
        toast.success("🌳 Family goal reached! Everyone hit 30 plants!")
      }, 400)
    }
  }, [mwPlants, members, loading, weekStart])

  // ── Derived ────────────────────────────────────────────────────────────────

  const libraryMap    = new Map(library.map(p => [p.id, p]))
  const todayLocalStr = toDateStr(new Date())

  // Convert a UTC ISO timestamp to a local YYYY-MM-DD string
  function localDateStr(iso: string) { return toDateStr(new Date(iso)) }

  // Pending = logged today (local time). Only meaningful for the current week.
  const confirmedMwPlants = isCurrentWeek
    ? mwPlants.filter(wp => localDateStr(wp.created_at) < todayLocalStr)
    : mwPlants
  const pendingMwPlants = isCurrentWeek
    ? mwPlants.filter(wp => localDateStr(wp.created_at) === todayLocalStr)
    : []

  // Confirmed plant IDs per member (count towards goal)
  function memberPlantIds(memberId: string) {
    return new Set(confirmedMwPlants.filter(w => w.member_id === memberId).map(w => w.plant_id))
  }
  // Pending plant IDs per member (logged today, not yet counted)
  function memberPendingIds(memberId: string) {
    return new Set(pendingMwPlants.filter(w => w.member_id === memberId).map(w => w.plant_id))
  }
  // All plant IDs per member (for grid display)
  function memberAllIds(memberId: string) {
    return new Set(mwPlants.filter(w => w.member_id === memberId).map(w => w.plant_id))
  }

  // Family total = sum of each member's confirmed count only
  const familyGoal  = members.length > 0 && members.every(m => memberPlantIds(m.id).size >= GOAL)
  const familyCount = members.reduce((sum, m) => sum + memberPlantIds(m.id).size, 0)
  const familyMax   = members.length * GOAL
  const familyPct   = familyMax > 0 ? Math.min(100, Math.round((familyCount / familyMax) * 100)) : 0

  function isNew(plantId: string, memberId: string): boolean {
    const d = discoveries.find(x => x.plant_id === plantId && x.member_id === memberId)
    return !!d && d.first_eaten_date >= weekStart
  }

  // ── Scroll to member section ───────────────────────────────────────────────

  function scrollToMember(memberId: string) {
    document.getElementById(`member-section-${memberId}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  // ── Log dialog ─────────────────────────────────────────────────────────────

  function openLog(member: FamilyMember | null = null) {
    setLogForMember(member)
    setLogPlants([])
    setLogMemberIds(member ? [member.id] : members.map(m => m.id))
    setLogShowError(false)
    setLogOpen(true)
  }

  async function submitLog() {
    if (logPlants.length === 0 || logMemberIds.length === 0) {
      setLogShowError(true); return
    }
    setLogging(true); setLogShowError(false)
    const newDisc: Array<{ name: string; memberName: string }> = []

    for (const plant of logPlants) {
      for (const memberId of logMemberIds) {
        const { data } = await supabase.rpc("log_plant_for_member", {
          p_plant_id:   plant.id,
          p_member_id:  memberId,
          p_week_start: weekStart,
          p_added_by:   "manual",
          p_meal_id:    null,
        })
        if (data?.was_new_discovery) {
          const m = members.find(m => m.id === memberId)
          newDisc.push({ name: plant.name, memberName: m?.name ?? "Someone" })
        }
      }
    }

    await fetchData()
    setLogging(false)
    setLogOpen(false)
    setLogPlants([])

    if (newDisc.length === 1) {
      toast.success(`🎉 First time! ${newDisc[0].memberName} tried ${newDisc[0].name}`)
    } else if (newDisc.length > 1) {
      toast.success(`🎉 ${newDisc.length} new discoveries this week!`)
    } else {
      toast.success(`🌿 Logged ${logPlants.length} plant${logPlants.length > 1 ? "s" : ""}`)
    }
  }

  // ── Quick-log toggle (tap in library) ──────────────────────────────────────

  async function quickLog(plant: Plant, memberId: string) {
    const ids = memberAllIds(memberId)
    if (ids.has(plant.id)) {
      scheduleDelete(plant.id, plant.name, memberId)
      return
    }
    const { data } = await supabase.rpc("log_plant_for_member", {
      p_plant_id:   plant.id,
      p_member_id:  memberId,
      p_week_start: weekStart,
      p_added_by:   "manual",
      p_meal_id:    null,
    })
    await fetchData()
    if (data?.was_new_discovery) {
      const m = members.find(m => m.id === memberId)
      toast.success(`🎉 First time! ${m?.name ?? "Someone"} tried ${plant.name}`)
    } else if (!data?.was_duplicate) {
      toast.success(`Added ${plant.name}`)
    }
  }

  // ── Delete with 3-second undo ──────────────────────────────────────────────

  function scheduleDelete(plantId: string, plantName: string, memberId: string) {
    const key = `${plantId}::${memberId}`

    // Cancel any existing pending delete for same plant/member
    if (deleteTimers.current.has(key)) {
      clearTimeout(deleteTimers.current.get(key)!)
      deleteTimers.current.delete(key)
    }

    // Optimistic UI removal
    setMwPlants(prev => prev.filter(wp => !(wp.plant_id === plantId && wp.member_id === memberId)))

    const toastId = toast(`Removed ${plantName}`, {
      duration: 3500,
      action: {
        label: "Undo",
        onClick: () => {
          const t = deleteTimers.current.get(key)
          if (t) { clearTimeout(t); deleteTimers.current.delete(key) }
          toast.dismiss(toastId)
          fetchData() // DB row still exists — just refresh
        },
      },
    })

    const timer = setTimeout(async () => {
      deleteTimers.current.delete(key)

      // Delete from DB
      const { error } = await supabase
        .from("member_weekly_plants")
        .delete()
        .eq("plant_id", plantId)
        .eq("member_id", memberId)
        .eq("week_start", weekStart)

      if (error) { await fetchData(); toast.error("Couldn't remove plant."); return }

      // Update discovery record
      const { data: disc } = await supabase
        .from("plant_discoveries")
        .select("id, times_eaten")
        .eq("plant_id", plantId)
        .eq("member_id", memberId)
        .single()

      if (disc) {
        if (disc.times_eaten <= 1) {
          await supabase.from("plant_discoveries").delete().eq("id", disc.id)
        } else {
          await supabase.from("plant_discoveries")
            .update({ times_eaten: disc.times_eaten - 1 })
            .eq("id", disc.id)
        }
      }
      await fetchData()
    }, 3500)

    deleteTimers.current.set(key, timer)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div ref={pageRef} className="flex flex-col p-3 lg:p-5 gap-6 max-w-5xl mx-auto w-full pb-24">

      {/* ── Week navigation ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <Button variant="outline" size="icon" className="h-8 w-8"
          onClick={() => setWeekStart(w => addWeeks(w, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8"
          onClick={() => setWeekStart(w => addWeeks(w, 1))}>
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

      {/* ── Summary: family plant + member progress cards ──────────────── */}
      <div className="flex flex-col sm:flex-row gap-4">

        {/* Family plant card */}
        <div className="rounded-2xl border-2 bg-card p-5 flex flex-col items-center gap-3 shrink-0
          sm:w-[200px]"
          style={{ borderColor: familyGoal ? "#22c55e" : undefined }}
        >
          <GrowingPlant count={familyGoal ? 30 : Math.floor((familyPct / 100) * 30)} size="lg" />

          <div className="w-full space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">
                {familyGoal ? "🌳 Goal reached!" : "🌳 Family"}
              </span>
              <span className={cn(
                "text-xl font-black tabular-nums",
                familyGoal ? "text-green-500" : "text-foreground",
              )}>
                {familyCount}<span className="text-xs font-normal text-muted-foreground"> / {familyMax}</span>
              </span>
            </div>
            <div className="relative h-2.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  familyGoal ? "bg-green-500" : "bg-primary",
                )}
                style={{ width: `${familyPct}%` }}
              />
            </div>
            {!familyGoal && (
              <p className="text-[11px] text-muted-foreground text-center">
                {familyMax - familyCount} more to reach the goal
              </p>
            )}
          </div>
        </div>

        {/* Member progress cards — horizontal scroll */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {[1,2,3].map(i => <Skeleton key={i} className="h-36 w-32 rounded-2xl shrink-0" />)}
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground italic py-8 text-center">
              Add family members in Settings.
            </p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2 sm:flex-wrap sm:overflow-visible">
              {members.map((m, idx) => {
                const count   = memberPlantIds(m.id).size
                const pending = memberPendingIds(m.id).size
                const pct     = Math.min(100, Math.round((count / GOAL) * 100))
                const color   = m.color ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length]
                const goal    = count >= GOAL

                return (
                  <button
                    key={m.id}
                    onClick={() => scrollToMember(m.id)}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-2xl border-2 bg-card px-4 py-4 shrink-0",
                      "hover:bg-muted/30 active:scale-95 transition-all cursor-pointer",
                      "w-[120px] sm:w-[130px]",
                      goal ? "border-green-400 dark:border-green-600" : "border-border",
                    )}
                  >
                    {/* Ring with avatar in centre */}
                    <div className="relative flex items-center justify-center">
                      <MiniRing pct={pct} color={goal ? "#22c55e" : color} size={64} />
                      <span className="absolute text-2xl leading-none">{m.avatar_emoji ?? "👤"}</span>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold leading-tight truncate max-w-[96px]"
                        style={{ color }}>
                        {m.name}
                      </p>
                      <p className={cn(
                        "text-sm font-black tabular-nums mt-0.5",
                        goal ? "text-green-500" : "text-foreground",
                      )}>
                        🌱 {count}<span className="text-xs font-normal text-muted-foreground"> / {GOAL}</span>
                      </p>
                      {goal && (
                        <p className="text-[10px] font-bold text-green-500 mt-0.5">🎉 Done!</p>
                      )}
                      {!goal && pending > 0 && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">🕐 +{pending} pending</p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Per-member sections ───────────────────────────────────────────── */}
      {members.map((m, idx) => {
        const confirmedIds = memberPlantIds(m.id)
        const pendingIds   = memberPendingIds(m.id)
        const allIds       = memberAllIds(m.id)
        const count        = confirmedIds.size
        const pending      = pendingIds.size
        const pct          = Math.min(100, Math.round((count / GOAL) * 100))
        const color        = m.color ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length]
        const goal         = count >= GOAL

        // Grid shows all plants (confirmed + pending)
        const loggedPlants = Array.from(allIds)
          .map(pid => libraryMap.get(pid))
          .filter(Boolean) as Plant[]

        return (
          <section
            key={m.id}
            id={`member-section-${m.id}`}
            className="rounded-2xl border-2 bg-card overflow-hidden"
            style={{ borderColor: goal ? "#22c55e" : undefined }}
          >
            {/* Section header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b bg-muted/20">
              <span
                className="text-3xl leading-none p-2 rounded-full shrink-0"
                style={{ backgroundColor: `${color}22` }}
              >
                {m.avatar_emoji ?? "👤"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg font-bold" style={{ color }}>{m.name}</h3>
                  {goal && <span className="text-xs font-bold text-green-500">🎉 Goal reached!</span>}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 relative h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: goal ? "#22c55e" : color }}
                    />
                  </div>
                  <div className="text-right shrink-0">
                    <span className={cn(
                      "text-sm font-black tabular-nums",
                      goal ? "text-green-500" : "text-foreground",
                    )}>
                      🌱 {count} / {GOAL}
                    </span>
                    {!goal && pending > 0 && (
                      <p className="text-[11px] text-muted-foreground">🕐 +{pending} pending</p>
                    )}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 gap-1.5"
                onClick={() => openLog(m)}
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Add plant for</span>
                <span>{m.name}</span>
              </Button>
            </div>

            {/* Plant emoji grid */}
            <div className="p-4">
              {loading ? (
                <div className="grid grid-cols-6 sm:grid-cols-8 lg:grid-cols-11 gap-2">
                  {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-14 rounded-lg" />)}
                </div>
              ) : loggedPlants.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
                  <span className="text-4xl">🌱</span>
                  <p className="text-sm">No plants logged yet</p>
                  <Button size="sm" variant="outline" className="gap-1.5 mt-1"
                    onClick={() => openLog(m)}>
                    <Plus className="h-3.5 w-3.5" /> Add first plant
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-6 sm:grid-cols-8 lg:grid-cols-11 gap-2">
                  {loggedPlants.map(p => (
                    <PlantCard
                      key={p.id}
                      plant={p}
                      isNew={isNew(p.id, m.id)}
                      isPending={pendingIds.has(p.id)}
                      onDelete={() => scheduleDelete(p.id, p.name, m.id)}
                    />
                  ))}
                  {/* Add more button */}
                  <button
                    onClick={() => openLog(m)}
                    className={cn(
                      "flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed",
                      "border-border hover:border-primary/50 hover:bg-muted/40 transition-all",
                      "aspect-square p-2 text-muted-foreground/50 hover:text-primary",
                    )}
                  >
                    <Plus className="h-5 w-5" />
                    <span className="text-[10px] font-medium">Add</span>
                  </button>
                </div>
              )}
            </div>

            {/* Plant library for this member — collapsible */}
            <MemberLibrary
              member={m}
              library={library}
              loggedIds={allIds}
              onQuickLog={(plant) => quickLog(plant, m.id)}
            />
          </section>
        )
      })}

      {/* ── Garden encyclopedia ───────────────────────────────────────────── */}
      <GardenEncyclopedia
        library={library}
        members={members}
        discoveries={discoveries}
        loading={loading}
      />

      {/* ── Log dialog ────────────────────────────────────────────────────── */}
      <Dialog
        open={logOpen}
        onOpenChange={o => {
          if (!o) { setLogOpen(false); setLogPlants([]); setLogShowError(false); setLogForMember(null) }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {logForMember
                ? `🌱 Add plants for ${logForMember.avatar_emoji ?? ""} ${logForMember.name}`
                : "🌱 Log plants for the family"}
            </DialogTitle>
            <p className="text-xs text-muted-foreground">{weekLabel(weekStart)}</p>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <PlantPicker
              selected={logPlants}
              onAdd={p => setLogPlants(prev => prev.some(x => x.id === p.id) ? prev : [...prev, p])}
              onRemove={id => setLogPlants(prev => prev.filter(x => x.id !== id))}
              label="Which plants?"
            />
            {members.length > 0 && (
              <MemberSelector
                members={members}
                selected={logMemberIds}
                onChange={setLogMemberIds}
                label="Who ate this?"
                required
                showError={logShowError}
              />
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm"
              onClick={() => { setLogOpen(false); setLogPlants([]); setLogShowError(false) }}>
              Cancel
            </Button>
            <Button size="sm" onClick={submitLog}
              disabled={logging || logPlants.length === 0 || logMemberIds.length === 0}>
              {logging
                ? "Saving…"
                : `Log ${logPlants.length > 0 ? logPlants.length : ""} plant${logPlants.length !== 1 ? "s" : ""}`
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── FAB ────────────────────────────────────────────────────────────── */}
      <button
        onClick={() => openLog(null)}
        className={cn(
          "fixed z-40 flex items-center justify-center w-14 h-14 rounded-full shadow-lg lg:hidden",
          "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all",
          "bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] right-5",
        )}
        aria-label="Log plants"
      >
        <Plus className="h-6 w-6" />
      </button>
    </div>
  )
}

// ── Plant emoji card ───────────────────────────────────────────────────────────

function PlantCard({ plant, isNew, isPending, onDelete }: {
  plant: Plant
  isNew: boolean
  isPending: boolean
  onDelete: () => void
}) {
  return (
    <div className={cn("relative group aspect-square", isPending && "opacity-60")}>
      <div className={cn(
        "relative flex flex-col items-center justify-center gap-0.5 rounded-lg p-1 h-full",
        "border-2 border-transparent hover:border-border transition-all",
        CATEGORY_COLORS[plant.category] ?? CATEGORY_COLORS.other,
      )}>
        {/* Pending clock — replaces the green confirmed border feel */}
        {isPending && (
          <span className="absolute top-0.5 left-0.5 text-[9px] leading-none select-none">🕐</span>
        )}

        {/* Plant emoji */}
        <span className="text-[20px] leading-none select-none">{plant.emoji ?? "🌿"}</span>
        {/* Plant name */}
        <span className="text-[9px] font-semibold text-center leading-tight line-clamp-2">
          {plant.name}
        </span>

        {/* Delete button — subtle always, prominent on hover */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className={cn(
            "absolute top-1 right-1 rounded-full p-0.5",
            "bg-background/60 text-muted-foreground/50",
            "hover:bg-destructive/90 hover:text-white",
            "opacity-30 group-hover:opacity-100 transition-all",
          )}
          aria-label={`Remove ${plant.name}`}
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* NEW ribbon — shows immediately even for pending plants (req 6) */}
      {isNew && (
        <div className="absolute -top-2 -left-1 z-10">
          <span className="text-[9px] font-black uppercase bg-amber-400 text-amber-900
            rounded-full px-1.5 py-0.5 shadow-sm whitespace-nowrap">
            NEW! 🎉
          </span>
        </div>
      )}
    </div>
  )
}

// ── Member plant library (collapsible) ────────────────────────────────────────

function MemberLibrary({ member, library, loggedIds, onQuickLog }: {
  member: FamilyMember
  library: Plant[]
  loggedIds: Set<string>
  onQuickLog: (plant: Plant) => void
}) {
  const [open, setOpen] = useState(false)
  const [catFilter, setCatFilter] = useState<string | null>(null)

  const filtered = catFilter ? library.filter(p => p.category === catFilter) : library

  return (
    <div className="border-t">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium
          hover:bg-muted/30 transition-colors text-muted-foreground"
      >
        <span>Browse full plant library for {member.name}</span>
        <span className="text-xs">{open ? "▲ Hide" : "▼ Show"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Tap to add · tap a logged plant (
            <X className="inline h-2.5 w-2.5 align-middle" />) to remove
          </p>

          {/* Category filters */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCatFilter(null)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors",
                !catFilter ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted",
              )}
            >All</button>
            {ALL_CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setCatFilter(cat === catFilter ? null : cat)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors",
                  catFilter === cat ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted",
                )}
              >
                {CATEGORY_LABELS[cat]?.split(" ")[1] ?? cat}
              </button>
            ))}
          </div>

          {/* Plant chips grid */}
          <div className="flex flex-wrap gap-1.5">
            {filtered.map(p => {
              const logged = loggedIds.has(p.id)
              return (
                <button
                  key={p.id}
                  onClick={() => onQuickLog(p)}
                  title={logged ? `Remove ${p.name}` : `Log ${p.name}`}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full text-xs font-medium",
                    "px-2.5 py-1 border-2 transition-all",
                    logged
                      ? cn("border-transparent", CATEGORY_COLORS[p.category] ?? CATEGORY_COLORS.other, "hover:opacity-75")
                      : "border-border bg-background hover:border-primary/50 hover:bg-muted/50 text-muted-foreground",
                  )}
                  style={logged ? {} : {}}
                >
                  <span className="leading-none">{p.emoji ?? "🌿"}</span>
                  {p.name}
                  {logged && <X className="h-2.5 w-2.5 opacity-60" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Garden Encyclopedia ────────────────────────────────────────────────────────

function GardenEncyclopedia({ library, members, discoveries, loading }: {
  library: Plant[]
  members: FamilyMember[]
  discoveries: PlantDiscovery[]
  loading: boolean
}) {
  const [catFilter, setCatFilter] = useState<string | null>(null)

  const discoveredIds = new Set(discoveries.map(d => d.plant_id))
  const discovered    = library.filter(p => discoveredIds.has(p.id))
  const sorted        = [...discovered].sort((a, b) => {
    const ac = discoveries.filter(d => d.plant_id === a.id).length
    const bc = discoveries.filter(d => d.plant_id === b.id).length
    return bc !== ac ? bc - ac : a.name.localeCompare(b.name)
  })
  const filtered = catFilter ? sorted.filter(p => p.category === catFilter) : sorted

  if (loading) return (
    <section className="rounded-2xl border-2 border-border bg-card p-5 space-y-3">
      <Skeleton className="h-6 w-40 rounded" />
      {[1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
    </section>
  )

  return (
    <section className="rounded-2xl border-2 border-border bg-card overflow-hidden" id="garden-encyclopedia">
      <div className="px-5 py-4 border-b bg-muted/20">
        <h2 className="text-base font-bold">🌿 Our Garden</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Every plant the family has ever tried — {discovered.length} discovered
        </p>
      </div>

      {discovered.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3 text-muted-foreground">
          <span className="text-5xl">🌱</span>
          <p className="text-sm font-medium">The garden is empty</p>
          <p className="text-xs text-center opacity-70">
            Start logging plants to grow your family&apos;s garden!
          </p>
        </div>
      ) : (
        <div className="p-5 space-y-4">
          {/* Category filters */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCatFilter(null)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors",
                !catFilter ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted",
              )}
            >All</button>
            {ALL_CATEGORIES.map(cat => (
              <button key={cat}
                onClick={() => setCatFilter(cat === catFilter ? null : cat)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors",
                  catFilter === cat ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted",
                )}
              >
                {CATEGORY_LABELS[cat]?.split(" ")[1] ?? cat}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {filtered.map(plant => {
              const plantDiscs = discoveries.filter(d => d.plant_id === plant.id)
              return (
                <div key={plant.id} className="rounded-xl border bg-background px-4 py-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl leading-none shrink-0">{plant.emoji ?? "🌿"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm leading-tight">{plant.name}</p>
                      <span className={cn(
                        "text-[10px] font-semibold uppercase tracking-wider rounded-full px-1.5 py-0.5",
                        CATEGORY_COLORS[plant.category] ?? CATEGORY_COLORS.other,
                      )}>
                        {plant.category}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {plantDiscs.length}/{members.length} tried
                    </span>
                  </div>

                  {/* Per-member breakdown */}
                  <div className="flex flex-wrap gap-1.5">
                    {members.map((m, idx) => {
                      const disc  = plantDiscs.find(d => d.member_id === m.id)
                      const color = m.color ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length]
                      return (
                        <div
                          key={m.id}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border",
                            !disc && "border-dashed border-border/40 text-muted-foreground/30",
                          )}
                          style={disc ? { color, borderColor: color, backgroundColor: `${color}15` } : undefined}
                        >
                          <span className="leading-none">{m.avatar_emoji ?? "👤"}</span>
                          <span>{m.name}</span>
                          {disc && (
                            <span className="opacity-60 text-[10px]">
                              {new Date(disc.first_eaten_date + "T00:00:00").toLocaleDateString("en-AU", {
                                day: "numeric", month: "short",
                              })}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
