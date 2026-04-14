"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Plus, CheckCircle2, Circle, Pencil, Trash2, BarChart2, CalendarDays, ClipboardList, RefreshCw, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase"
import { useRealtimeChannel } from "@/lib/use-realtime"
import { ErrorBoundary } from "@/components/error-boundary"
import {
  startOfWeek,
  addDays,
  toDateStr,
  weekDays,
  WEEKDAY_LABELS,
  type FamilyMember,
  type Chore,
} from "./_utils"
import { ChoreSheet } from "./_chore-sheet"
import { WeeklySummary } from "./_weekly-summary"

// ── Stable realtime config ─────────────────────────────────────────────────────
const CHORES_TABLES = [{ table: "chores" }] as const
const STREAK_TABLES = [{ table: "chore_streaks" }] as const

// ── Types ──────────────────────────────────────────────────────────────────────

interface ChoreStreak {
  member_id: string
  streak_count: number
  longest_streak: number
  last_completed_date: string | null
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ChoresPage() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [weekStart, setWeekStart] = useState(startOfWeek(today))
  const [members, setMembers] = useState<FamilyMember[]>([])
  const [chores, setChores] = useState<Chore[]>([])
  const [loading, setLoading] = useState(true)

  // Mobile: active day index (0=Mon…6=Sun) within the displayed week
  const [mobileDayIdx, setMobileDayIdx] = useState(() => {
    const dow = today.getDay() // 0=Sun…6=Sat
    return Math.min(6, Math.max(0, dow === 0 ? 6 : dow - 1)) // Mon-based
  })

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingChore, setEditingChore] = useState<Chore | null>(null)
  const [defaultDate, setDefaultDate] = useState<string | undefined>()
  const [defaultMemberId, setDefaultMemberId] = useState<string | undefined>()

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Chore | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Streak data: memberId → ChoreStreak
  const [streaks, setStreaks] = useState<Map<string, ChoreStreak>>(new Map())

  // Weekly summary overlay
  const [summaryOpen, setSummaryOpen] = useState(false)

  // Swipe tracking for mobile day navigation
  const swipeStartX  = useRef<number | null>(null)
  const swipeStartY  = useRef<number | null>(null)
  const SWIPE_THRESHOLD = 50

  const supabase = useRef(createClient()).current

  const days = weekDays(weekStart)
  const weekEnd = addDays(weekStart, 6)

  // ── Fetch data ────────────────────────────────────────────────────────────

  const fetchMembers = useCallback(async () => {
    const { data } = await supabase
      .from("family_members")
      .select("id, name, avatar_emoji, color")
      .order("created_at")
    setMembers(data ?? [])
  }, [supabase])

  const fetchChores = useCallback(async () => {
    const { data, error } = await supabase
      .from("chores")
      .select("*")
      .gte("due_date", toDateStr(weekStart))
      .lte("due_date", toDateStr(weekEnd))
      .order("created_at")

    if (error) {
      console.error("Failed to fetch chores:", error.message)
    } else {
      setChores(data ?? [])
    }
    setLoading(false)
  }, [supabase, weekStart, weekEnd])

  useEffect(() => {
    fetchMembers()
  }, [fetchMembers])

  useEffect(() => {
    setLoading(true)
    fetchChores()
  }, [fetchChores])

  // ── Streaks ───────────────────────────────────────────────────────────────

  const fetchStreaks = useCallback(async () => {
    const { data } = await supabase
      .from("chore_streaks")
      .select("member_id, streak_count, longest_streak, last_completed_date")
    const map = new Map<string, ChoreStreak>()
    for (const row of (data ?? []) as ChoreStreak[]) {
      map.set(row.member_id, row)
    }
    setStreaks(map)
  }, [supabase])

  useEffect(() => { fetchStreaks() }, [fetchStreaks])

  // ── Realtime ──────────────────────────────────────────────────────────────

  // ── Realtime (with backoff reconnection + status reporting) ──────────────
  useRealtimeChannel(supabase, `chores-week-${toDateStr(weekStart)}`, CHORES_TABLES, fetchChores)
  useRealtimeChannel(supabase, "chores-streaks", STREAK_TABLES, fetchStreaks)

  // ── Navigation ────────────────────────────────────────────────────────────

  function prevWeek() { setWeekStart((d) => addDays(d, -7)) }
  function nextWeek() { setWeekStart((d) => addDays(d, 7)) }
  function goThisWeek() { setWeekStart(startOfWeek(today)) }

  const isThisWeek = toDateStr(weekStart) === toDateStr(startOfWeek(today))

  // Mobile: go to previous/next day, crossing week boundary as needed
  function mobilePrevDay() {
    if (mobileDayIdx > 0) {
      setMobileDayIdx((i) => i - 1)
    } else {
      setWeekStart((d) => addDays(d, -7))
      setMobileDayIdx(6)
    }
  }
  function mobileNextDay() {
    if (mobileDayIdx < 6) {
      setMobileDayIdx((i) => i + 1)
    } else {
      setWeekStart((d) => addDays(d, 7))
      setMobileDayIdx(0)
    }
  }

  // ── Swipe handlers ─────────────────────────────────────────────────────────

  function onTouchStart(e: React.TouchEvent) {
    swipeStartX.current = e.touches[0].clientX
    swipeStartY.current = e.touches[0].clientY
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (swipeStartX.current === null || swipeStartY.current === null) return
    const dx = e.changedTouches[0].clientX - swipeStartX.current
    const dy = e.changedTouches[0].clientY - swipeStartY.current
    // Only treat as horizontal swipe if wider than tall
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) mobileNextDay(); else mobilePrevDay()
    }
    swipeStartX.current = null
    swipeStartY.current = null
  }

  // ── Toggle complete ────────────────────────────────────────────────────────

  async function toggleComplete(chore: Chore) {
    const completed = !chore.completed
    // Optimistic update
    setChores((prev) =>
      prev.map((c) => c.id === chore.id ? { ...c, completed, completed_at: completed ? new Date().toISOString() : null } : c),
    )
    const { error } = await supabase
      .from("chores")
      .update({
        completed,
        completed_at: completed ? new Date().toISOString() : null,
      })
      .eq("id", chore.id)
    if (error) {
      // Revert optimistic update
      setChores((prev) => prev.map((c) => c.id === chore.id ? chore : c))
      toast.error("Couldn't update chore. Please try again.")
    } else if (completed && chore.assigned_to && chore.due_date) {
      // Fire-and-forget streak update; re-fetch streak state afterwards
      supabase.rpc("update_chore_streak", {
        p_member_id: chore.assigned_to,
        p_date: chore.due_date,
      }).then(() => fetchStreaks())
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(scope: "this" | "future" | "all") {
    if (!deleteTarget) return
    setDeleting(true)

    if (scope === "this" || !deleteTarget.recur_series_id) {
      await supabase.from("chores").delete().eq("id", deleteTarget.id)
    } else if (scope === "future") {
      const today = toDateStr(new Date())
      await supabase
        .from("chores")
        .delete()
        .eq("recur_series_id", deleteTarget.recur_series_id)
        .gte("due_date", today)
    } else {
      // "all" — entire series including past
      await supabase
        .from("chores")
        .delete()
        .eq("recur_series_id", deleteTarget.recur_series_id)
    }

    setDeleting(false)
    setDeleteTarget(null)
  }

  // ── Open sheet ────────────────────────────────────────────────────────────

  function openCreate(date?: string, memberId?: string) {
    setEditingChore(null)
    setDefaultDate(date)
    setDefaultMemberId(memberId)
    setSheetOpen(true)
  }

  function openEdit(chore: Chore) {
    setEditingChore(chore)
    setDefaultDate(undefined)
    setDefaultMemberId(undefined)
    setSheetOpen(true)
  }

  function closeSheet() {
    setSheetOpen(false)
    setTimeout(() => setEditingChore(null), 300)
  }

  // ── Build cell map ─────────────────────────────────────────────────────────
  // Map: memberId -> dayIndex -> Chore[]
  // Unassigned chores get a virtual "unassigned" row

  const cellMap = new Map<string, Map<number, Chore[]>>()

  // Initialise rows for all members + one unassigned row
  const rowKeys = [...members.map((m) => m.id), "__unassigned__"]
  for (const key of rowKeys) {
    cellMap.set(key, new Map(Array.from({ length: 7 }, (_, i) => [i, []])))
  }

  for (const chore of chores) {
    if (!chore.due_date) continue
    const choreDate = new Date(chore.due_date + "T00:00:00")
    const dayIdx = days.findIndex((d) => toDateStr(d) === toDateStr(choreDate))
    if (dayIdx === -1) continue
    const key = chore.assigned_to ?? "__unassigned__"
    cellMap.get(key)?.get(dayIdx)?.push(chore)
  }

  // Filter out unassigned row if empty
  const unassignedChores = Array.from(cellMap.get("__unassigned__")?.values() ?? []).flat()
  const showUnassigned = unassignedChores.length > 0

  // Index of today within the displayed week (-1 if viewing another week)
  const todayIdx = days.findIndex((d) => toDateStr(d) === toDateStr(today))

  // ── Pocket money totals per member (completed chores this week) ─────────────
  const weeklyEarnings = new Map<string, number>()
  for (const chore of chores) {
    if (!chore.completed || !chore.assigned_to || !chore.pocket_money_value) continue
    weeklyEarnings.set(
      chore.assigned_to,
      (weeklyEarnings.get(chore.assigned_to) ?? 0) + chore.pocket_money_value,
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // Format week range label
  const weekLabel = (() => {
    const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }
    return `${weekStart.toLocaleDateString("en-AU", opts)} – ${weekEnd.toLocaleDateString("en-AU", opts)}, ${weekEnd.getFullYear()}`
  })()

  // ── Mobile day data ────────────────────────────────────────────────────────

  const mobileDay = days[mobileDayIdx]
  const mobileDateStr = toDateStr(mobileDay)
  const isMobileToday = toDateStr(mobileDay) === toDateStr(today)

  // Chores for the selected mobile day, grouped by member
  const mobileMemberGroups = (() => {
    const groups: { member: FamilyMember | null; key: string; chores: Chore[] }[] = []
    const seen = new Set<string>()
    // Member rows
    for (const member of members) {
      const mc = chores.filter(
        (c) => c.due_date === mobileDateStr && c.assigned_to === member.id,
      )
      if (mc.length > 0) { groups.push({ member, key: member.id, chores: mc }); seen.add(member.id) }
    }
    // Unassigned
    const unassigned = chores.filter(
      (c) => c.due_date === mobileDateStr && !c.assigned_to,
    )
    if (unassigned.length > 0) groups.push({ member: null, key: "__unassigned__", chores: unassigned })
    return groups
  })()

  return (
    <div className="flex flex-col lg:h-full p-3 lg:p-4 gap-3">

      {/* ── Desktop Header ───────────────────────────────────────────────── */}
      <div className="hidden lg:flex items-center gap-2 shrink-0 flex-wrap">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevWeek}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextWeek}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <h2 className="text-base font-semibold shrink-0">{weekLabel}</h2>
        {!isThisWeek && (
          <Button variant="outline" size="sm" className="h-8" onClick={goThisWeek}>
            This week
          </Button>
        )}
        {loading && (
          <Skeleton className="h-4 w-16 rounded" />
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 ml-auto"
          onClick={() => setSummaryOpen(true)}
        >
          <BarChart2 className="h-3.5 w-3.5" />
          Summary
        </Button>
      </div>

      {/* ── Mobile Header ────────────────────────────────────────────────── */}
      <div className="lg:hidden flex items-center gap-2 shrink-0">
        <Button variant="outline" size="icon" className="h-11 w-11" onClick={mobilePrevDay}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 text-center">
          <p className={cn("text-lg font-bold", isMobileToday && "text-primary")}>
            {isMobileToday ? "Today" : mobileDay.toLocaleDateString("en-AU", { weekday: "long" })}
          </p>
          <p className="text-sm text-muted-foreground">
            {mobileDay.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        <Button variant="outline" size="icon" className="h-11 w-11" onClick={mobileNextDay}>
          <ChevronRight className="h-5 w-5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11"
          onClick={() => setSummaryOpen(true)}
          aria-label="Weekly summary"
        >
          <BarChart2 className="h-5 w-5" />
        </Button>
      </div>

      {/* ── Mobile: Day view with swipe ──────────────────────────────────── */}
      <div
        className="lg:hidden flex-1 overflow-y-auto rounded-lg border bg-background"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {loading ? (
          <div className="px-4 py-4 space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-5 w-24 rounded" />
                <Skeleton className="h-11 rounded-lg" />
                <Skeleton className="h-11 rounded-lg" />
              </div>
            ))}
          </div>
        ) : mobileMemberGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
            <CalendarDays className="h-10 w-10 opacity-30" />
            <p className="text-sm">No chores {isMobileToday ? "today" : "this day"}</p>
            <Button size="sm" variant="outline" onClick={() => openCreate(mobileDateStr)}>
              Add a chore
            </Button>
          </div>
        ) : (
          <div className="divide-y">
            {mobileMemberGroups.map(({ member, key, chores: mc }) => (
              <div key={key} className="px-4 py-4">
                {/* Member heading */}
                <div className="flex items-center gap-2 mb-3">
                  {member?.avatar_emoji && (
                    <span className="text-xl leading-none">{member.avatar_emoji}</span>
                  )}
                  <span
                    className="text-sm font-semibold"
                    style={member?.color ? { color: member.color } : undefined}
                  >
                    {member?.name ?? "Unassigned"}
                  </span>
                  {member && (() => {
                    const s = streaks.get(member.id)
                    return s && s.streak_count >= 1
                      ? <StreakBadge streak={s.streak_count} longest={s.longest_streak} />
                      : null
                  })()}
                  {member && weeklyEarnings.has(member.id) && (
                    <span
                      className="ml-auto text-sm font-semibold tabular-nums"
                      style={{ color: member.color ?? "#6366f1" }}
                    >
                      S${(weeklyEarnings.get(member.id) ?? 0).toFixed(2)}
                    </span>
                  )}
                </div>
                {/* Chore chips */}
                <div className="flex flex-col gap-2">
                  {mc.map((chore) => (
                    <ChoreChip
                      key={chore.id}
                      chore={chore}
                      member={member}
                      onToggle={toggleComplete}
                      onEdit={openEdit}
                      onDelete={setDeleteTarget}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Desktop Grid ──────────────────────────────────────────────────── */}
      <ErrorBoundary label="Chores grid">
      <div className="hidden lg:flex flex-1 overflow-auto rounded-lg border bg-background">
        <table className="w-full min-w-[640px] border-collapse table-fixed">
          {/* Column headers */}
          <thead>
            <tr>
              {/* Member column */}
              <th className="w-28 lg:w-36 border-b border-r bg-muted/40 px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                Person
              </th>
              {days.map((day, i) => {
                const isToday = toDateStr(day) === toDateStr(today)
                return (
                  <th
                    key={i}
                    className={cn(
                      "border-b border-r last:border-r-0 px-2 py-2 text-center text-xs font-medium",
                      isToday ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground",
                    )}
                  >
                    <div className="font-bold">{WEEKDAY_LABELS[i]}</div>
                    <div className={cn(
                      "text-[10px] font-normal",
                      isToday ? "opacity-80" : "text-muted-foreground/70",
                    )}>
                      {day.getDate()}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>

          <tbody>
            {/* Member rows */}
            {[...members.map((m) => ({ key: m.id, member: m })),
              ...(showUnassigned ? [{ key: "__unassigned__", member: null }] : [])
            ].map(({ key, member }) => (
              <tr key={key} className="group/row">
                {/* Member cell */}
                <td className="border-b border-r px-3 py-2 align-top">
                  <div className="flex flex-col gap-1">
                    {member ? (
                      <>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-base leading-none">{member.avatar_emoji}</span>
                          <span
                            className="text-xs font-medium truncate"
                            style={{ color: member.color ?? undefined }}
                          >
                            {member.name}
                          </span>
                          {(() => {
                            const hasTodayChores = todayIdx >= 0 && (cellMap.get(member.id)?.get(todayIdx)?.length ?? 0) > 0
                            const s = hasTodayChores ? streaks.get(member.id) : undefined
                            return s && s.streak_count >= 1
                              ? <StreakBadge streak={s.streak_count} longest={s.longest_streak} />
                              : null
                          })()}
                        </div>
                        {/* Weekly earnings — only shown when there's at least one valued chore */}
                        {weeklyEarnings.has(member.id) && (
                          <span
                            className="text-[11px] font-semibold tabular-nums"
                            style={{ color: member.color ?? "#6366f1" }}
                          >
                            S${(weeklyEarnings.get(member.id) ?? 0).toFixed(2)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Unassigned</span>
                    )}
                  </div>
                </td>

                {/* Day cells */}
                {days.map((day, di) => {
                  const dayChores = cellMap.get(key)?.get(di) ?? []
                  const isToday = toDateStr(day) === toDateStr(today)

                  return (
                    <td
                      key={di}
                      className={cn(
                        "border-b border-r last:border-r-0 px-1.5 py-1.5 align-top",
                        "min-h-[72px] cursor-pointer group/cell transition-colors",
                        isToday ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-muted/30",
                      )}
                      onClick={() => openCreate(toDateStr(day), member?.id)}
                    >
                      <div className="flex flex-col gap-1">
                        {dayChores.map((chore) => (
                          <ChoreChip
                            key={chore.id}
                            chore={chore}
                            member={member}
                            onToggle={toggleComplete}
                            onEdit={openEdit}
                            onDelete={setDeleteTarget}
                          />
                        ))}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}

            {/* Empty state */}
            {members.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <ClipboardList className="h-10 w-10 opacity-30" />
                    <p className="text-sm font-medium">No family members yet</p>
                    <p className="text-xs">Add members in Settings to start tracking chores.</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </ErrorBoundary>

      {/* ── FAB ──────────────────────────────────────────────────────────── */}
      <button
        onClick={() => openCreate(
          // On mobile, pre-fill the currently viewed day
          typeof window !== "undefined" && window.innerWidth < 1024 ? mobileDateStr : undefined,
        )}
        className={cn(
          "fixed z-40 flex items-center justify-center w-14 h-14 rounded-full shadow-lg",
          "bg-primary text-primary-foreground",
          "hover:bg-primary/90 active:scale-95 transition-all",
          // Mobile: above bottom nav + safe area; Desktop: bottom-right
          "bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] right-5",
          "lg:bottom-6 lg:right-6",
        )}
        aria-label="Add chore"
      >
        <Plus className="h-6 w-6" />
      </button>

      {/* ── Chore sheet ───────────────────────────────────────────────────── */}
      <ChoreSheet
        open={sheetOpen}
        onClose={closeSheet}
        members={members}
        chore={editingChore}
        defaultDate={defaultDate}
        defaultMemberId={defaultMemberId}
      />

      {/* ── Weekly summary overlay ───────────────────────────────────────── */}
      {summaryOpen && (
        <WeeklySummary
          members={members}
          initialWeekStart={weekStart}
          onClose={() => setSummaryOpen(false)}
        />
      )}

      {/* ── Delete confirm ────────────────────────────────────────────────── */}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete chore?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            &ldquo;{deleteTarget?.title}&rdquo;
            {deleteTarget?.recur_series_id ? " is part of a recurring series." : " will be permanently removed."}
          </p>
          <DialogFooter className={cn("gap-2", deleteTarget?.recur_series_id && "flex-col sm:flex-col")}>
            {deleteTarget?.recur_series_id ? (
              <>
                <Button variant="outline" size="sm" onClick={() => handleDelete("this")} disabled={deleting}>
                  Delete this chore only
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleDelete("future")} disabled={deleting}>
                  Delete this + all future
                </Button>
                <Button variant="destructive" size="sm" onClick={() => handleDelete("all")} disabled={deleting}>
                  {deleting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                  Delete entire series
                </Button>
              </>
            ) : (
              <>
                <DialogClose>
                  <Button variant="outline" size="sm">Cancel</Button>
                </DialogClose>
                <Button variant="destructive" size="sm" onClick={() => handleDelete("this")} disabled={deleting}>
                  {deleting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                  Delete
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Streak badge sub-component ─────────────────────────────────────────────────

function StreakBadge({ streak, longest }: { streak: number; longest: number }) {
  const isHot = streak >= 7
  return (
    <Popover>
      <PopoverTrigger
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums select-none",
          isHot ? "text-orange-500" : "text-amber-500",
        )}
        style={isHot ? { textShadow: "0 0 8px #f59e0b, 0 0 16px #f59e0b80" } : undefined}
        aria-label={`${streak} day streak`}
      >
        <span className={isHot ? "text-sm" : "text-xs"}>🔥</span>
        {streak}
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-auto px-3 py-2 text-sm">
        <p className="font-semibold">{streak} day streak 🔥</p>
        <p className="text-xs text-muted-foreground">Longest ever: {longest} days</p>
      </PopoverContent>
    </Popover>
  )
}

// ── Chore chip sub-component ───────────────────────────────────────────────────

function ChoreChip({
  chore,
  member,
  onToggle,
  onEdit,
  onDelete,
}: {
  chore: Chore
  member: FamilyMember | null
  onToggle: (c: Chore) => void
  onEdit: (c: Chore) => void
  onDelete: (c: Chore) => void
}) {
  const [open, setOpen] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [moneyValue, setMoneyValue] = useState(String(chore.pocket_money_value ?? 0))
  const [savingMoney, setSavingMoney] = useState(false)
  const accentColor = member?.color ?? "#6366f1"
  const supabase = createClient()

  // Keep local input in sync if chore prop changes (realtime update)
  useEffect(() => {
    setMoneyValue(String(chore.pocket_money_value ?? 0))
  }, [chore.pocket_money_value])

  async function handleToggle() {
    setToggling(true)
    await onToggle(chore)
    setToggling(false)
    setTimeout(() => setOpen(false), 350)
  }

  async function handleSaveMoney() {
    const val = parseFloat(moneyValue)
    if (isNaN(val) || val === chore.pocket_money_value) return
    setSavingMoney(true)
    await supabase
      .from("chores")
      .update({ pocket_money_value: val })
      .eq("id", chore.id)
    setSavingMoney(false)
    // Realtime will update the chip
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-full text-left rounded border transition-all duration-200",
          "min-h-[36px] lg:min-h-[44px]",
          "px-2 py-1.5 lg:px-2.5 lg:py-2",
          chore.completed
            ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-900"
            : "bg-background border-border hover:border-primary/40 hover:shadow-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {chore.completed
            ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
            : <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" />
          }
          <span
            className={cn(
              "flex-1 min-w-0 truncate text-xs lg:text-sm font-medium leading-snug",
              chore.completed && "line-through text-muted-foreground",
            )}
          >
            {chore.title}
          </span>
          {chore.recur_series_id && (
            <RefreshCw className="shrink-0 h-3 w-3 text-muted-foreground/50" aria-label="Recurring" />
          )}
          {chore.pocket_money_value > 0 && (
            <span className="shrink-0 text-[10px] font-semibold" style={{ color: accentColor }}>
              S${chore.pocket_money_value.toFixed(2)}
            </span>
          )}
        </div>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        className="w-64 p-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b" style={{ borderLeftColor: accentColor, borderLeftWidth: 4 }}>
          <p className="font-semibold text-sm leading-snug">{chore.title}</p>
          {member && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {member.avatar_emoji} {member.name}
            </p>
          )}
          {chore.completed && chore.completed_at && (
            <p className="text-[11px] text-green-600 dark:text-green-400 mt-1">
              ✓ Done {new Date(chore.completed_at).toLocaleTimeString("en-AU", {
                hour: "2-digit", minute: "2-digit",
              })}
            </p>
          )}
        </div>

        {/* Inline pocket money editor */}
        <div className="px-4 py-3 border-b">
          <Label className="text-xs text-muted-foreground mb-1.5 block">Pocket money</Label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">
                S$
              </span>
              <Input
                type="number"
                min="0"
                step="0.50"
                value={moneyValue}
                onChange={(e) => setMoneyValue(e.target.value)}
                onBlur={handleSaveMoney}
                onKeyDown={(e) => e.key === "Enter" && handleSaveMoney()}
                className="pl-8 h-8 text-sm"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            {savingMoney && (
              <span className="text-[10px] text-muted-foreground animate-pulse">Saving…</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="p-3 flex flex-col gap-2">
          <Button
            size="sm"
            className={cn(
              "w-full h-11 text-sm font-semibold gap-2 transition-all",
              chore.completed
                ? "bg-muted text-foreground hover:bg-muted/80"
                : "bg-green-600 hover:bg-green-700 text-white",
            )}
            onClick={handleToggle}
            disabled={toggling}
          >
            {chore.completed
              ? <><Circle className="h-4 w-4" /> Mark Incomplete</>
              : <><CheckCircle2 className="h-4 w-4" /> Mark Complete</>
            }
          </Button>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5"
              onClick={() => { setOpen(false); onEdit(chore) }}
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5 text-destructive hover:text-destructive"
              onClick={() => { setOpen(false); onDelete(chore) }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
