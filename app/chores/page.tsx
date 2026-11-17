"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { MemberAvatar } from "@/components/member-avatar"
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

  // Pocket money balances: memberId -> all-time earned minus payouts
  const [balances, setBalances] = useState<Map<string, number>>(new Map())
  const [payoutsAvailable, setPayoutsAvailable] = useState(false)

  // Swipe tracking for mobile day navigation
  const swipeStartX  = useRef<number | null>(null)
  const swipeStartY  = useRef<number | null>(null)
  const SWIPE_THRESHOLD = 50

  const supabase = useRef(createClient()).current

  const days = weekDays(weekStart)
  // Memoised: a new Date every render would re-create fetchChores and refetch in a loop
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart])

  // ── Fetch data ────────────────────────────────────────────────────────────

  const fetchMembers = useCallback(async () => {
    const { data } = await supabase
      .from("family_members")
      .select("id, name, avatar_emoji, color, is_child")
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

  // ── Pocket money balances ─────────────────────────────────────────────────

  const fetchBalances = useCallback(async () => {
    const [{ data: earned }, { data: paid, error: paidError }] = await Promise.all([
      supabase.from("chores").select("assigned_to, pocket_money_value").eq("completed", true).gt("pocket_money_value", 0),
      supabase.from("pocket_money_payouts").select("member_id, amount"),
    ])
    setPayoutsAvailable(!paidError)
    const map = new Map<string, number>()
    for (const r of (earned ?? []) as { assigned_to: string | null; pocket_money_value: number }[]) {
      if (!r.assigned_to) continue
      map.set(r.assigned_to, (map.get(r.assigned_to) ?? 0) + Number(r.pocket_money_value))
    }
    for (const r of (paidError ? [] : paid ?? []) as { member_id: string; amount: number }[]) {
      map.set(r.member_id, (map.get(r.member_id) ?? 0) - Number(r.amount))
    }
    map.forEach((v, k) => map.set(k, Math.round(v * 100) / 100))
    setBalances(map)
  }, [supabase])

  // Recalculate whenever this week's tasks change (ticks, edits, realtime)
  useEffect(() => { fetchBalances() }, [fetchBalances, chores])

  async function resetBalance(member: FamilyMember, amount: number): Promise<boolean> {
    const { error } = await supabase
      .from("pocket_money_payouts")
      .insert({ member_id: member.id, amount, note: "Balance reset" })
    if (error) {
      toast.error("Couldn't reset the balance. Please try again.")
      return false
    }
    toast.success(`${member.name}'s balance reset (S$${amount.toFixed(2)} paid)`)
    fetchBalances()
    return true
  }

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
      toast.error("Couldn't update task. Please try again.")
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

  // ── Render helpers ─────────────────────────────────────────────────────────

  const weekLabel = (() => {
    const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }
    return `${weekStart.toLocaleDateString("en-GB", opts)} to ${weekEnd.toLocaleDateString("en-GB", opts)}`
  })()

  const weekTotal = chores.length
  const weekDone  = chores.filter((c) => c.completed).length
  const weekPct   = weekTotal > 0 ? Math.round((weekDone / weekTotal) * 100) : 0

  const rows = [
    ...members.map((m) => ({ key: m.id, member: m as FamilyMember | null })),
    ...(showUnassigned ? [{ key: "__unassigned__", member: null as FamilyMember | null }] : []),
  ]

  // ── Mobile day data ────────────────────────────────────────────────────────

  const mobileDay = days[mobileDayIdx]
  const mobileDateStr = toDateStr(mobileDay)
  const isMobileToday = toDateStr(mobileDay) === toDateStr(today)

  const mobileMemberGroups = (() => {
    const groups: { member: FamilyMember | null; key: string; chores: Chore[] }[] = []
    for (const member of members) {
      const mc = chores.filter((c) => c.due_date === mobileDateStr && c.assigned_to === member.id)
      if (mc.length > 0) groups.push({ member, key: member.id, chores: mc })
    }
    const unassigned = chores.filter((c) => c.due_date === mobileDateStr && !c.assigned_to)
    if (unassigned.length > 0) groups.push({ member: null, key: "__unassigned__", chores: unassigned })
    return groups
  })()

  const walletMembers = members.filter((m) =>
    m.is_child || Math.abs(balances.get(m.id) ?? 0) > 0.001 || weeklyEarnings.has(m.id),
  )

  const pocketMoney = (
    <PocketMoneyPanel
      members={walletMembers}
      balances={balances}
      weeklyEarnings={weeklyEarnings}
      payoutsAvailable={payoutsAvailable}
      onReset={resetBalance}
    />
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col lg:h-full p-4 lg:px-8 lg:py-7 gap-4 lg:gap-5">

      {/* ── Desktop header ───────────────────────────────────────────────── */}
      <div className="hidden lg:flex items-center gap-3 shrink-0">
        <div className="mr-2">
          <h1 className="font-display text-[34px] font-semibold tracking-tight leading-tight">Tasks</h1>
          <p className="text-[15px] text-muted-foreground">{weekLabel}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon" className="size-11 rounded-xl bg-card" onClick={prevWeek} aria-label="Previous week">
            <ChevronLeft className="size-5" />
          </Button>
          <Button variant="outline" size="icon" className="size-11 rounded-xl bg-card" onClick={nextWeek} aria-label="Next week">
            <ChevronRight className="size-5" />
          </Button>
          {!isThisWeek && (
            <Button variant="outline" className="h-11 px-4 rounded-xl bg-card" onClick={goThisWeek}>This week</Button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-4">
          {weekTotal > 0 && (
            <div className="flex flex-col items-end gap-1.5">
              <span className="text-sm font-semibold text-foreground/80 tabular-nums">{weekDone} of {weekTotal} done this week</span>
              <span className="h-2 w-48 rounded-full bg-secondary overflow-hidden">
                <span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${weekPct}%` }} />
              </span>
            </div>
          )}
          <Button variant="outline" className="h-11 px-4 rounded-xl bg-card gap-2" onClick={() => setSummaryOpen(true)}>
            <BarChart2 className="size-4" />
            Summary
          </Button>
          <Button className="h-11 px-4 rounded-xl gap-2" onClick={() => openCreate()}>
            <Plus className="size-[18px]" />
            New task
          </Button>
        </div>
      </div>

      {/* ── Mobile header ────────────────────────────────────────────────── */}
      <div className="lg:hidden flex items-center gap-2 shrink-0">
        <Button variant="outline" size="icon" className="size-11 rounded-xl bg-card" onClick={mobilePrevDay} aria-label="Previous day">
          <ChevronLeft className="size-5" />
        </Button>
        <div className="flex-1 text-center">
          <p className={cn("font-display text-[22px] font-semibold leading-tight", isMobileToday && "text-primary")}>
            {isMobileToday ? "Today" : mobileDay.toLocaleDateString("en-GB", { weekday: "long" })}
          </p>
          <p className="text-sm text-muted-foreground">
            {mobileDay.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}
          </p>
        </div>
        <Button variant="outline" size="icon" className="size-11 rounded-xl bg-card" onClick={mobileNextDay} aria-label="Next day">
          <ChevronRight className="size-5" />
        </Button>
        <Button variant="outline" size="icon" className="size-11 rounded-xl bg-card" onClick={() => setSummaryOpen(true)} aria-label="Weekly summary">
          <BarChart2 className="size-5" />
        </Button>
      </div>

      {/* ── Mobile: day view with swipe ──────────────────────────────────── */}
      <div className="lg:hidden flex flex-col gap-4" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {loading && chores.length === 0 ? (
          <div className="space-y-3">
            {[1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-3xl" />)}
          </div>
        ) : mobileMemberGroups.length === 0 ? (
          <div className="rounded-3xl border-[1.5px] border-dashed border-input flex flex-col items-center justify-center py-14 gap-3 text-muted-foreground">
            <CalendarDays className="size-9" />
            <p className="text-base font-semibold">No tasks {isMobileToday ? "today" : "this day"}</p>
            <Button variant="outline" className="rounded-xl bg-card" onClick={() => openCreate(mobileDateStr)}>Add a task</Button>
          </div>
        ) : (
          mobileMemberGroups.map(({ member, key, chores: mc }) => {
            const done = mc.filter((c) => c.completed).length
            const s = member ? streaks.get(member.id) : undefined
            return (
              <section key={key} className="rounded-3xl bg-card border border-border p-4 flex flex-col gap-2.5">
                <div className="flex items-center gap-2.5">
                  <MemberAvatar member={member ?? { name: "?" }} className="size-9 text-[17px]" />
                  <span className="text-[17px] font-semibold">{member?.name ?? "Anyone"}</span>
                  {s && s.streak_count >= 1 && <StreakBadge streak={s.streak_count} longest={s.longest_streak} />}
                  <span className="ml-auto text-sm font-semibold text-muted-foreground tabular-nums">{done}/{mc.length}</span>
                </div>
                {mc.map((chore) => (
                  <ChoreChip key={chore.id} chore={chore} member={member} onToggle={toggleComplete} onEdit={openEdit} onDelete={setDeleteTarget} />
                ))}
              </section>
            )
          })
        )}
        {walletMembers.length > 0 && pocketMoney}
      </div>

      {/* ── Desktop: week board + pocket money ──────────────────────────── */}
      <ErrorBoundary label="Tasks grid">
      <div className="hidden lg:grid lg:flex-1 lg:min-h-0 gap-5" style={{ gridTemplateColumns: walletMembers.length > 0 ? "minmax(0,1fr) 272px" : "minmax(0,1fr)" }}>
        <section className="flex flex-col min-h-0 rounded-[28px] bg-card border border-border p-3">
          {/* Day headers */}
          <div className="grid gap-1.5 shrink-0 pb-1.5" style={{ gridTemplateColumns: "104px repeat(7, minmax(0,1fr))" }}>
            <span />
            {days.map((day, i) => {
              const isToday = i === todayIdx
              return (
                <div key={i} className={cn(
                  "flex flex-col items-center gap-0.5 rounded-xl py-2",
                  isToday ? "bg-foreground text-background" : "text-foreground/80",
                )}>
                  <span className="text-[12px] font-semibold uppercase tracking-[0.06em]">{WEEKDAY_LABELS[i]}</span>
                  <span className="font-display text-[19px] font-semibold leading-none">{day.getDate()}</span>
                </div>
              )
            })}
          </div>

          {/* Rows */}
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
            {loading && members.length === 0 ? (
              <div className="flex flex-col gap-3 p-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
              </div>
            ) : members.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground py-16">
                <ClipboardList className="size-10" />
                <p className="text-base font-semibold">No family members yet</p>
                <p className="text-sm">Add members in Settings to start tracking tasks.</p>
              </div>
            ) : rows.map(({ key, member }) => {
              const rowChores = Array.from(cellMap.get(key)?.values() ?? []).flat()
              const rowDone = rowChores.filter((c) => c.completed).length
              const hasTodayChores = todayIdx >= 0 && (cellMap.get(key)?.get(todayIdx)?.length ?? 0) > 0
              const s = member && hasTodayChores ? streaks.get(member.id) : undefined
              return (
                <div
                  key={key}
                  className="grid gap-1.5 border-t border-border/70 py-1.5 min-h-[104px] flex-1"
                  style={{ gridTemplateColumns: "104px repeat(7, minmax(0,1fr))" }}
                >
                  <div className="flex flex-col gap-1.5 px-2 py-1.5 min-w-0">
                    {member ? (
                      <>
                        <MemberAvatar member={member} className="size-10 text-[18px]" />
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="text-[15px] font-semibold truncate">{member.name}</span>
                          {s && s.streak_count >= 1 && <StreakBadge streak={s.streak_count} longest={s.longest_streak} />}
                        </div>
                        {rowChores.length > 0 && (
                          <span className="text-[12px] text-muted-foreground tabular-nums">{rowDone} of {rowChores.length} done</span>
                        )}
                      </>
                    ) : (
                      <span className="text-sm font-medium text-muted-foreground pt-2">Anyone</span>
                    )}
                  </div>

                  {days.map((day, di) => {
                    const dayChores = cellMap.get(key)?.get(di) ?? []
                    const isToday = di === todayIdx
                    return (
                      <div
                        key={di}
                        role="button"
                        tabIndex={0}
                        aria-label={`Add a task for ${member?.name ?? "anyone"} on ${day.toLocaleDateString("en-GB", { weekday: "long" })}`}
                        onClick={() => openCreate(toDateStr(day), member?.id)}
                        onKeyDown={(e) => { if (e.key === "Enter") openCreate(toDateStr(day), member?.id) }}
                        className={cn(
                          "group/cell flex flex-col gap-1 rounded-2xl p-1.5 min-w-0 cursor-pointer transition-colors",
                          isToday ? "bg-accent/50 hover:bg-accent/80" : "hover:bg-secondary/60",
                        )}
                      >
                        {dayChores.map((chore) => (
                          <ChoreChip key={chore.id} chore={chore} member={member} onToggle={toggleComplete} onEdit={openEdit} onDelete={setDeleteTarget} />
                        ))}
                        {dayChores.length === 0 && (
                          <span className="m-auto opacity-0 group-hover/cell:opacity-100 transition-opacity text-muted-foreground">
                            <Plus className="size-4" />
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </section>

        {walletMembers.length > 0 && <aside className="min-h-0 overflow-y-auto">{pocketMoney}</aside>}
      </div>
      </ErrorBoundary>

      {/* ── Mobile FAB ───────────────────────────────────────────────────── */}
      <button
        onClick={() => openCreate(mobileDateStr)}
        className={cn(
          "lg:hidden fixed z-30 flex items-center justify-center size-14 rounded-full shadow-lg",
          "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all",
          "bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] right-5",
        )}
        aria-label="Add task"
      >
        <Plus className="size-6" />
      </button>

      <ChoreSheet
        open={sheetOpen}
        onClose={closeSheet}
        members={members}
        chore={editingChore}
        defaultDate={defaultDate}
        defaultMemberId={defaultMemberId}
      />

      {summaryOpen && (
        <WeeklySummary members={members} initialWeekStart={weekStart} onClose={() => setSummaryOpen(false)} />
      )}

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete task?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            &ldquo;{deleteTarget?.title}&rdquo;
            {deleteTarget?.recur_series_id ? " is part of a recurring series." : " will be permanently removed."}
          </p>
          <DialogFooter className={cn("gap-2", deleteTarget?.recur_series_id && "flex-col sm:flex-col")}>
            {deleteTarget?.recur_series_id ? (
              <>
                <Button variant="outline" onClick={() => handleDelete("this")} disabled={deleting}>Delete this task only</Button>
                <Button variant="outline" onClick={() => handleDelete("future")} disabled={deleting}>Delete this and all future</Button>
                <Button variant="destructive" onClick={() => handleDelete("all")} disabled={deleting}>
                  {deleting && <Loader2 className="size-4 mr-1.5 animate-spin" />}
                  Delete entire series
                </Button>
              </>
            ) : (
              <>
                <DialogClose>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button variant="destructive" onClick={() => handleDelete("this")} disabled={deleting}>
                  {deleting && <Loader2 className="size-4 mr-1.5 animate-spin" />}
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

// ── Pocket money panel ─────────────────────────────────────────────────────────

function PocketMoneyPanel({
  members, balances, weeklyEarnings, payoutsAvailable, onReset,
}: {
  members: FamilyMember[]
  balances: Map<string, number>
  weeklyEarnings: Map<string, number>
  payoutsAvailable: boolean
  onReset: (member: FamilyMember, amount: number) => Promise<boolean>
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <section className="rounded-[28px] bg-card border border-border p-5 flex flex-col gap-3.5">
      <h2 className="font-display text-[22px] font-semibold">Pocket money</h2>
      {members.map((m) => {
        const balance = balances.get(m.id) ?? 0
        const week = weeklyEarnings.get(m.id) ?? 0
        const color = m.color ?? "#B85F1A"
        const isConfirming = confirming === m.id
        return (
          <div key={m.id} className="rounded-2xl p-4 flex flex-col gap-2.5" style={{ backgroundColor: `${color}1F` }}>
            <div className="flex items-center gap-2.5">
              <MemberAvatar member={m} className="size-9 text-[16px]" />
              <span className="text-[15px] font-semibold">{m.name}</span>
              <span className="ml-auto font-display text-[26px] font-semibold tabular-nums">S${balance.toFixed(2)}</span>
            </div>
            <span className="text-[13px] text-muted-foreground">S${week.toFixed(2)} earned this week</span>
            {payoutsAvailable && balance > 0 && (
              isConfirming ? (
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 rounded-xl bg-card" onClick={() => setConfirming(null)} disabled={busy}>Cancel</Button>
                  <Button
                    variant="destructive"
                    className="flex-[1.4] rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      const ok = await onReset(m, balance)
                      setBusy(false)
                      if (ok) setConfirming(null)
                    }}
                  >
                    {busy && <Loader2 className="size-4 animate-spin" />}
                    Paid S${balance.toFixed(2)}, reset
                  </Button>
                </div>
              ) : (
                <Button variant="outline" className="rounded-xl bg-card" onClick={() => setConfirming(m.id)}>
                  Reset to zero
                </Button>
              )
            )}
          </div>
        )
      })}
      {!payoutsAvailable && (
        <p className="text-[13px] text-muted-foreground leading-snug">
          Balances show everything earned so far. To reset them after paying out, run the pocket money database update in Supabase.
        </p>
      )}
    </section>
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
          "w-full text-left rounded-xl border transition-all duration-200",
          "min-h-[48px] lg:min-h-[38px]",
          "px-3 py-2 lg:px-1.5 lg:py-1.5",
          chore.completed
            ? "bg-accent border-accent"
            : "bg-card border-border hover:border-primary/40 hover:shadow-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <div className="flex items-start gap-1.5 min-w-0">
          {chore.completed
            ? <CheckCircle2 className="size-5 lg:size-4 shrink-0 text-primary mt-px" />
            : <Circle className="size-5 lg:size-4 shrink-0 text-muted-foreground/60 mt-px" />
          }
          <span className="flex-1 min-w-0 flex flex-col lg:gap-0">
            <span
              className={cn(
                "truncate lg:whitespace-normal lg:line-clamp-2 lg:[overflow-wrap:normal] lg:hyphens-auto text-[15px] lg:text-[12.5px] font-medium leading-snug",
                chore.completed && "line-through text-muted-foreground",
              )}
            >
              {chore.title}
            </span>
            {chore.pocket_money_value > 0 && (
              <span className="text-[12px] lg:text-[11px] font-semibold text-[#8A4B12] dark:text-[#F0C08A] tabular-nums leading-tight">
                S${chore.pocket_money_value.toFixed(2)}
              </span>
            )}
          </span>
          {chore.recur_series_id && (
            <RefreshCw className="shrink-0 size-3 mt-1 text-muted-foreground/50" aria-label="Recurring" />
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
            <p className="text-[11px] text-primary mt-1">
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
                : "bg-primary hover:bg-primary/90 text-primary-foreground",
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
