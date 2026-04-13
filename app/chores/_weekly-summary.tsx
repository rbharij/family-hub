"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import confetti from "canvas-confetti"
import { ChevronLeft, ChevronRight, X, Printer, CheckCircle2, Circle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import {
  startOfWeek,
  addDays,
  toDateStr,
  weekDays,
  type FamilyMember,
  type Chore,
} from "./_utils"
import { ProgressRing } from "./_progress-ring"

// ── Types ──────────────────────────────────────────────────────────────────────

interface MemberSummary {
  member: FamilyMember
  total: number
  done: number
  earned: number
  chores: Chore[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatWeekLabel(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6)
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }
  return `${weekStart.toLocaleDateString("en-AU", opts)} – ${weekEnd.toLocaleDateString("en-AU", opts)} ${weekEnd.getFullYear()}`
}

// Palette for members without a colour set
const FALLBACK_COLORS = ["#6366f1", "#ec4899", "#f59e0b", "#14b8a6", "#8b5cf6", "#3b82f6"]

// ── Component ──────────────────────────────────────────────────────────────────

interface WeeklySummaryProps {
  members: FamilyMember[]
  initialWeekStart: Date
  onClose: () => void
}

export function WeeklySummary({ members, initialWeekStart, onClose }: WeeklySummaryProps) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [weekStart, setWeekStart] = useState(initialWeekStart)
  const [chores, setChores] = useState<Chore[]>([])
  const [loading, setLoading] = useState(true)
  const firedConfetti = useRef(new Set<string>())
  const supabase = useRef(createClient()).current

  const weekEnd = addDays(weekStart, 6)
  const days = weekDays(weekStart)

  // ── Fetch chores for displayed week ────────────────────────────────────────

  const fetchChores = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from("chores")
      .select("*")
      .gte("due_date", toDateStr(weekStart))
      .lte("due_date", toDateStr(weekEnd))
    setChores(data ?? [])
    setLoading(false)
  }, [supabase, weekStart, weekEnd])

  useEffect(() => {
    firedConfetti.current.clear()
    fetchChores()
  }, [fetchChores])

  // Realtime: keep summary in sync with grid completions
  useEffect(() => {
    const channel = supabase
      .channel(`summary-${toDateStr(weekStart)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chores" }, fetchChores)
      .subscribe()
    return () => { channel.unsubscribe() }
  }, [supabase, fetchChores, weekStart])

  // ── Build per-member summaries ─────────────────────────────────────────────

  const summaries: MemberSummary[] = members.map((member) => {
    const memberChores = chores.filter((c) => c.assigned_to === member.id)
    const done = memberChores.filter((c) => c.completed).length
    const earned = memberChores
      .filter((c) => c.completed && c.pocket_money_value > 0)
      .reduce((s, c) => s + c.pocket_money_value, 0)
    // Sort: incomplete first (ascending due_date), then completed
    const sorted = [...memberChores].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      return (a.due_date ?? "").localeCompare(b.due_date ?? "")
    })
    return { member, total: memberChores.length, done, earned, chores: sorted }
  }).filter((s) => s.total > 0)   // hide members with no chores this week

  // ── Confetti for 100% members ──────────────────────────────────────────────

  useEffect(() => {
    if (loading) return
    for (const s of summaries) {
      if (s.total > 0 && s.done === s.total && !firedConfetti.current.has(s.member.id)) {
        firedConfetti.current.add(s.member.id)
        const color = s.member.color ?? FALLBACK_COLORS[0]
        confetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.55 },
          colors: [color, "#ffffff", "#fde68a"],
          zIndex: 9999,
        })
      }
    }
  }, [summaries, loading])

  // ── Keyboard: Escape closes ────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // ── Print ──────────────────────────────────────────────────────────────────

  function handlePrint() { window.print() }

  // ── Render ─────────────────────────────────────────────────────────────────

  const isCurrentWeek = toDateStr(weekStart) === toDateStr(startOfWeek(today))

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-background overflow-y-auto",
        "print:static print:overflow-visible",
      )}
    >
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b print:hidden">
        <div className="flex items-center gap-3 px-4 py-3 max-w-7xl mx-auto">
          {/* Week navigation */}
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0"
            onClick={() => setWeekStart((d) => addDays(d, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0"
            onClick={() => setWeekStart((d) => addDays(d, 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>

          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold leading-none">Weekly Summary</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{formatWeekLabel(weekStart)}</p>
          </div>

          {!isCurrentWeek && (
            <Button variant="outline" size="sm"
              onClick={() => setWeekStart(startOfWeek(today))}>
              This week
            </Button>
          )}

          <Button variant="outline" size="sm" className="gap-1.5 print:hidden"
            onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            <span className="hidden sm:inline">Print</span>
          </Button>

          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Print-only header ────────────────────────────────────────────── */}
      <div className="hidden print:block px-8 pt-6 pb-4 border-b">
        <h1 className="text-2xl font-bold">Weekly Chores Summary</h1>
        <p className="text-base text-gray-500">{formatWeekLabel(weekStart)}</p>
      </div>

      {/* ── Day labels strip ─────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 pt-5 pb-2 print:px-8">
        <div className="flex gap-1 justify-center">
          {days.map((d, i) => {
            const isToday = toDateStr(d) === toDateStr(today)
            return (
              <span
                key={i}
                className={cn(
                  "text-xs font-medium px-2 py-0.5 rounded-full",
                  isToday
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground",
                )}
              >
                {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][i]} {d.getDate()}
              </span>
            )
          })}
        </div>
      </div>

      {/* ── Member cards ─────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 pb-12 print:px-8 print:pb-4">
        {loading ? (
          <div className="flex items-center justify-center py-32 text-muted-foreground animate-pulse text-lg">
            Loading…
          </div>
        ) : summaries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 gap-3 text-muted-foreground">
            <span className="text-5xl">🗓️</span>
            <p className="text-xl font-medium">No chores assigned this week</p>
          </div>
        ) : (
          <div className={cn(
            "grid gap-5 mt-4",
            summaries.length === 1 ? "grid-cols-1 max-w-sm mx-auto" :
            summaries.length === 2 ? "grid-cols-1 sm:grid-cols-2" :
            summaries.length === 3 ? "grid-cols-1 sm:grid-cols-3" :
            "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
          )}>
            {summaries.map((s, idx) => (
              <MemberCard
                key={s.member.id}
                summary={s}
                color={s.member.color ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length]}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Member card ────────────────────────────────────────────────────────────────

function MemberCard({ summary, color }: { summary: MemberSummary; color: string }) {
  const { member, total, done, earned, chores } = summary
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const allDone = total > 0 && done === total

  return (
    <div
      className={cn(
        "rounded-2xl border-2 bg-card p-5 flex flex-col gap-5",
        "print:break-inside-avoid print:border print:shadow-none",
        allDone ? "border-green-400 dark:border-green-600" : "border-border",
      )}
    >
      {/* ── Member header ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <span
          className="text-4xl leading-none p-2 rounded-full"
          style={{ backgroundColor: `${color}22` }}
        >
          {member.avatar_emoji ?? "👤"}
        </span>
        <div className="min-w-0">
          <h2
            className="text-2xl font-extrabold leading-tight truncate"
            style={{ color }}
          >
            {member.name}
          </h2>
          {allDone && (
            <span className="text-sm font-semibold text-green-500">
              🎉 All done!
            </span>
          )}
        </div>
      </div>

      {/* ── Progress ring ─────────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-3">
        <ProgressRing
          pct={pct}
          size={160}
          strokeWidth={14}
          color={allDone ? "#22c55e" : color}
        >
          <span className="text-4xl font-black tabular-nums" style={{ color: allDone ? "#22c55e" : color }}>
            {pct}%
          </span>
        </ProgressRing>

        <p className="text-lg font-semibold text-muted-foreground">
          {done} of {total} done
        </p>

        {/* Pocket money */}
        {earned > 0 && (
          <div
            className="flex flex-col items-center rounded-xl px-5 py-3 w-full"
            style={{ backgroundColor: `${color}18` }}
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
              Pocket Money Earned
            </span>
            <span
              className="text-4xl font-black tabular-nums"
              style={{ color }}
            >
              S${earned.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* ── Chore list ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        {chores.map((chore) => (
          <div
            key={chore.id}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-base font-medium",
              chore.completed
                ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300"
                : "bg-muted/50 text-foreground",
            )}
          >
            {chore.completed
              ? <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
              : <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" />
            }
            <span className={cn("flex-1 min-w-0", chore.completed && "line-through opacity-70")}>
              {chore.title}
            </span>
            {chore.pocket_money_value > 0 && (
              <span
                className="text-sm font-bold shrink-0 tabular-nums"
                style={{ color: chore.completed ? "#22c55e" : undefined }}
              >
                S${chore.pocket_money_value.toFixed(2)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
