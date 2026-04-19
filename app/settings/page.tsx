"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  RefreshCw, Loader2, Plus, Pencil, Trash2, Check, X,
  Users, Palette, CalendarSync, Home, Tv2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase"
import { useAppSettings } from "@/lib/app-settings-context"
import { useIdleTimeout } from "@/lib/idle-timeout-context"
import { Switch } from "@/components/ui/switch"
import { useTheme } from "@/components/theme-provider"

// ── Constants ─────────────────────────────────────────────────────────────────

const EMOJIS = [
  "👩","👨","👧","👦","👶","👴","👵","🧑","🧒",
  "👩‍🍳","👨‍🍳","👩‍💼","👨‍💼","👩‍🎨","👨‍🎨","👩‍🏫","👨‍🏫",
  "🦸‍♀️","🦸‍♂️","🧙‍♀️","🧙‍♂️",
  "🐶","🐱","🐻","🦊","🐼","🐨","🦁","🐸",
  "🌟","⭐","🌈","🌸","🍀","🎈","🎯","🏆",
]

const COLORS = [
  "#ef4444","#f97316","#eab308","#22c55e",
  "#14b8a6","#3b82f6","#8b5cf6","#ec4899",
  "#f59e0b","#06b6d4","#84cc16","#6366f1",
]

const HOURS = Array.from({ length: 24 }, (_, i) => i)
function fmtHour(h: number) {
  if (h === 0)  return "12 AM (midnight)"
  if (h === 12) return "12 PM (noon)"
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface BdEntry { id: string; name: string; date: string; type: "birthday"|"anniversary"; color: string }
interface BdForm  { name: string; month: number; day: number; type: "birthday"|"anniversary"; color: string }
const defaultBdForm = (): BdForm => ({ name:"", month:1, day:1, type:"birthday", color:"#534AB7" })
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
function formatBdDate(dateStr:string):string { const [,m,d]=dateStr.split("-").map(Number); return `${MONTH_NAMES[m-1]} ${d}` }
function formToDateStr(month:number,day:number):string { return `2000-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}` }

interface Member {
  id: string
  name: string
  avatar_emoji: string | null
  color: string | null
  is_child: boolean
}

interface MemberForm {
  name: string
  avatar_emoji: string
  color: string
  is_child: boolean
}

const defaultForm = (): MemberForm => ({
  name: "",
  avatar_emoji: "🧑",
  color: COLORS[5],
  is_child: false,
})

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { settings, updateSettings } = useAppSettings()
  const { darkFromHour, lightFromHour, updateThemeHours } = useTheme()
  const { enabled: idleEnabled, timeoutMs: idleTimeoutMs, setEnabled: setIdleEnabled, setTimeoutMs: setIdleTimeoutMs } = useIdleTimeout()

  // Family name
  const [familyName, setFamilyName] = useState(settings?.familyName ?? "Family Hub")
  const [savingName, setSavingName] = useState(false)

  // Members
  const [members, setMembers]         = useState<Member[]>([])
  const [loadingMembers, setLoadingMembers] = useState(true)
  const [editingId, setEditingId]     = useState<string | null>(null)
  const [editForm, setEditForm]       = useState<MemberForm>(defaultForm())
  const [showEmojiFor, setShowEmojiFor] = useState<string | null>(null)
  const [addingNew, setAddingNew]     = useState(false)
  const [newForm, setNewForm]         = useState<MemberForm>(defaultForm())
  const [showNewEmoji, setShowNewEmoji] = useState(false)
  const [deletingId, setDeletingId]   = useState<string | null>(null)
  const [savingMember, setSavingMember] = useState(false)

  // Birthdays & Anniversaries
  const [bdEntries, setBdEntries]     = useState<BdEntry[]>([])
  const [bdLoading, setBdLoading]     = useState(true)
  const [bdAddingNew, setBdAddingNew] = useState(false)
  const [bdNewForm, setBdNewForm]     = useState<BdForm>(defaultBdForm())
  const [bdEditingId, setBdEditingId] = useState<string | null>(null)
  const [bdEditForm, setBdEditForm]   = useState<BdForm>(defaultBdForm())
  const [bdDeletingId, setBdDeletingId] = useState<string | null>(null)
  const [bdSaving, setBdSaving]       = useState(false)

  // Theme hours
  const [dFrom, setDFrom] = useState(darkFromHour)
  const [lFrom, setLFrom] = useState(lightFromHour)
  const [savingHours, setSavingHours] = useState(false)

  // Google Calendar sync
  const [syncing, setSyncing]     = useState(false)
  const [lastSynced, setLastSynced] = useState<number | null>(() => {
    if (typeof window === "undefined") return null
    const v = localStorage.getItem("google-calendar-last-sync")
    return v ? parseInt(v) : null
  })

  const supabase = useRef(createClient()).current

  // Sync familyName state when settings load
  useEffect(() => {
    if (settings) setFamilyName(settings.familyName)
  }, [settings])

  // Sync hour state when theme context loads
  useEffect(() => {
    setDFrom(darkFromHour)
    setLFrom(lightFromHour)
  }, [darkFromHour, lightFromHour])

  // ── Members ───────────────────────────────────────────────────────────────

  const fetchMembers = useCallback(async () => {
    const { data } = await supabase
      .from("family_members")
      .select("id, name, avatar_emoji, color, is_child")
      .order("created_at")
    setMembers(data ?? [])
    setLoadingMembers(false)
  }, [supabase])

  useEffect(() => { fetchMembers() }, [fetchMembers])

  // ── Save family name ──────────────────────────────────────────────────────

  async function saveFamilyName() {
    const name = familyName.trim() || "Family Hub"
    setSavingName(true)
    await updateSettings({ familyName: name })
    setSavingName(false)
    toast.success("Family name updated")
  }

  // ── Member CRUD ───────────────────────────────────────────────────────────

  function startEdit(m: Member) {
    setEditingId(m.id)
    setEditForm({
      name: m.name,
      avatar_emoji: m.avatar_emoji ?? "🧑",
      color: m.color ?? COLORS[5],
      is_child: m.is_child,
    })
    setShowEmojiFor(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setShowEmojiFor(null)
  }

  async function saveEdit() {
    if (!editingId || !editForm.name.trim()) return
    setSavingMember(true)
    const { error } = await supabase
      .from("family_members")
      .update({
        name: editForm.name.trim(),
        avatar_emoji: editForm.avatar_emoji,
        color: editForm.color,
        is_child: editForm.is_child,
      })
      .eq("id", editingId)
    setSavingMember(false)
    if (error) { toast.error("Failed to save"); return }
    setMembers((prev) =>
      prev.map((m) =>
        m.id === editingId
          ? { ...m, ...editForm, name: editForm.name.trim() }
          : m,
      ),
    )
    setEditingId(null)
    toast.success("Member updated")
  }

  async function confirmDelete() {
    if (!deletingId) return
    await supabase.from("family_members").delete().eq("id", deletingId)
    setMembers((prev) => prev.filter((m) => m.id !== deletingId))
    setDeletingId(null)
    toast.success("Member removed")
  }

  async function addMember() {
    if (!newForm.name.trim()) return
    setSavingMember(true)
    const { data, error } = await supabase
      .from("family_members")
      .insert({
        name: newForm.name.trim(),
        avatar_emoji: newForm.avatar_emoji,
        color: newForm.color,
        is_child: newForm.is_child,
      })
      .select()
      .single()
    setSavingMember(false)
    if (error || !data) { toast.error("Failed to add member"); return }
    setMembers((prev) => [...prev, data as Member])
    setNewForm(defaultForm())
    setAddingNew(false)
    setShowNewEmoji(false)
    toast.success("Member added")
  }

  // ── Birthdays & Anniversaries ─────────────────────────────────────────────

  const fetchBirthdays = useCallback(async () => {
    const { data } = await supabase
      .from("birthdays")
      .select("id, name, date, type, color")
      .order("date")
    setBdEntries(data ?? [])
    setBdLoading(false)
  }, [supabase])

  useEffect(() => { fetchBirthdays() }, [fetchBirthdays])

  async function addBirthday() {
    if (!bdNewForm.name.trim()) return
    setBdSaving(true)
    const { data, error } = await supabase
      .from("birthdays")
      .insert({
        name: bdNewForm.name.trim(),
        date: formToDateStr(bdNewForm.month, bdNewForm.day),
        type: bdNewForm.type,
        color: bdNewForm.color,
      })
      .select()
      .single()
    setBdSaving(false)
    if (error || !data) { toast.error("Failed to add entry"); return }
    setBdEntries((prev) => [...prev, data as BdEntry])
    setBdNewForm(defaultBdForm())
    setBdAddingNew(false)
    toast.success("Added")
  }

  async function saveBirthdayEdit() {
    if (!bdEditingId || !bdEditForm.name.trim()) return
    setBdSaving(true)
    const { error } = await supabase
      .from("birthdays")
      .update({
        name: bdEditForm.name.trim(),
        date: formToDateStr(bdEditForm.month, bdEditForm.day),
        type: bdEditForm.type,
        color: bdEditForm.color,
      })
      .eq("id", bdEditingId)
    setBdSaving(false)
    if (error) { toast.error("Failed to save"); return }
    setBdEntries((prev) =>
      prev.map((b) =>
        b.id === bdEditingId
          ? { ...b, name: bdEditForm.name.trim(), date: formToDateStr(bdEditForm.month, bdEditForm.day), type: bdEditForm.type, color: bdEditForm.color }
          : b,
      ),
    )
    setBdEditingId(null)
    toast.success("Updated")
  }

  async function deleteBirthday() {
    if (!bdDeletingId) return
    await supabase.from("birthdays").delete().eq("id", bdDeletingId)
    setBdEntries((prev) => prev.filter((b) => b.id !== bdDeletingId))
    setBdDeletingId(null)
    toast.success("Removed")
  }

  // ── Theme hours ───────────────────────────────────────────────────────────

  async function saveThemeHours() {
    setSavingHours(true)
    updateThemeHours(dFrom, lFrom)
    await updateSettings({ darkFromHour: dFrom, lightFromHour: lFrom })
    setSavingHours(false)
    toast.success("Theme schedule updated")
  }

  // ── Google Calendar sync ──────────────────────────────────────────────────

  async function triggerSync() {
    setSyncing(true)
    try {
      const res = await fetch("/api/google-calendar/sync")
      if (!res.ok) throw new Error("Sync failed")
      const ts = Date.now()
      localStorage.setItem("google-calendar-last-sync", String(ts))
      setLastSynced(ts)
      toast.success("Google Calendar synced")
    } catch {
      toast.error("Sync failed. Check your Google Calendar credentials.")
    } finally {
      setSyncing(false)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function fmtLastSynced(ts: number) {
    const mins = Math.floor((Date.now() - ts) / 60_000)
    if (mins < 1) return "just now"
    if (mins === 1) return "1 minute ago"
    if (mins < 60) return `${mins} minutes ago`
    return new Date(ts).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-10">

      <h1 className="text-2xl font-bold">Settings</h1>

      {/* ── Family name ──────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader icon={<Home className="h-4 w-4" />} title="Family" />

        <div className="space-y-1.5">
          <Label htmlFor="settings-family-name">Family name</Label>
          <div className="flex gap-2">
            <Input
              id="settings-family-name"
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveFamilyName()}
              placeholder="The Smith Family"
              className="flex-1"
            />
            <Button onClick={saveFamilyName} disabled={savingName} size="sm" className="shrink-0">
              {savingName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Shown as &ldquo;{familyName || "Family Hub"}&rdquo; in the app header
          </p>
        </div>
      </section>

      {/* ── Family members ───────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader icon={<Users className="h-4 w-4" />} title="Family members" />

        {loadingMembers ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {members.map((m) =>
              editingId === m.id ? (
                <MemberEditRow
                  key={m.id}
                  form={editForm}
                  onChange={setEditForm}
                  showEmoji={showEmojiFor === m.id}
                  onToggleEmoji={() => setShowEmojiFor(showEmojiFor === m.id ? null : m.id)}
                  onSave={saveEdit}
                  onCancel={cancelEdit}
                  saving={savingMember}
                />
              ) : (
                <MemberRow
                  key={m.id}
                  member={m}
                  onEdit={() => startEdit(m)}
                  onDelete={() => setDeletingId(m.id)}
                />
              ),
            )}

            {/* Add new */}
            {addingNew ? (
              <MemberEditRow
                form={newForm}
                onChange={setNewForm}
                showEmoji={showNewEmoji}
                onToggleEmoji={() => setShowNewEmoji((v) => !v)}
                onSave={addMember}
                onCancel={() => { setAddingNew(false); setNewForm(defaultForm()); setShowNewEmoji(false) }}
                saving={savingMember}
                isNew
              />
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 mt-1"
                onClick={() => setAddingNew(true)}
              >
                <Plus className="h-4 w-4" /> Add member
              </Button>
            )}
          </div>
        )}
      </section>

      {/* ── Appearance ───────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader icon={<Palette className="h-4 w-4" />} title="Appearance" />

        <p className="text-sm text-muted-foreground">
          In Auto mode, the theme switches between light and dark based on the time of day.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="dark-from">Switch to dark theme at</Label>
            <select
              id="dark-from"
              value={dFrom}
              onChange={(e) => setDFrom(Number(e.target.value))}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>{fmtHour(h)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="light-from">Switch to light theme at</Label>
            <select
              id="light-from"
              value={lFrom}
              onChange={(e) => setLFrom(Number(e.target.value))}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>{fmtHour(h)}</option>
              ))}
            </select>
          </div>
        </div>

        <Button
          size="sm"
          onClick={saveThemeHours}
          disabled={savingHours}
          className="gap-2"
        >
          {savingHours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save schedule
        </Button>
      </section>

      {/* ── Wall display ─────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader icon={<Tv2 className="h-4 w-4" />} title="Wall display" />

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Auto wall display after idle</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Automatically switches to wall display when the screen is idle
            </p>
          </div>
          <Switch
            checked={idleEnabled}
            onCheckedChange={setIdleEnabled}
          />
        </div>

        {idleEnabled && (
          <div className="space-y-1.5">
            <Label htmlFor="idle-timeout-duration">Switch after</Label>
            <select
              id="idle-timeout-duration"
              value={idleTimeoutMs}
              onChange={(e) => setIdleTimeoutMs(Number(e.target.value))}
              className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring w-40"
            >
              <option value={120000}>2 minutes</option>
              <option value={300000}>5 minutes</option>
              <option value={600000}>10 minutes</option>
              <option value={900000}>15 minutes</option>
              <option value={1800000}>30 minutes</option>
            </select>
          </div>
        )}
      </section>

      {/* ── Google Calendar ───────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader icon={<CalendarSync className="h-4 w-4" />} title="Google Calendar" />

        <p className="text-sm text-muted-foreground">
          Pulls events from your linked Google Calendar into the app.
          Events created or edited in the app are pushed back automatically.
        </p>

        <div className="flex items-center gap-4 flex-wrap">
          <Button
            variant="outline"
            className="gap-2"
            onClick={triggerSync}
            disabled={syncing}
          >
            <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
          {lastSynced && !syncing && (
            <span className="text-sm text-muted-foreground">
              Last synced {fmtLastSynced(lastSynced)}
            </span>
          )}
        </div>
      </section>

      {/* ── Birthdays & Anniversaries ────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader icon={<span>🎂</span>} title="Birthdays & Anniversaries" />

        {bdLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {bdEntries.map((b) =>
              bdEditingId === b.id ? (
                <BdEditRow
                  key={b.id}
                  form={bdEditForm}
                  onChange={setBdEditForm}
                  onSave={saveBirthdayEdit}
                  onCancel={() => setBdEditingId(null)}
                  saving={bdSaving}
                />
              ) : (
                <BdEntryRow
                  key={b.id}
                  entry={b}
                  onEdit={() => {
                    const [,m,d] = b.date.split("-").map(Number)
                    setBdEditingId(b.id)
                    setBdEditForm({ name: b.name, month: m, day: d, type: b.type, color: b.color })
                  }}
                  onDelete={() => setBdDeletingId(b.id)}
                />
              ),
            )}

            {bdAddingNew ? (
              <BdEditRow
                form={bdNewForm}
                onChange={setBdNewForm}
                onSave={addBirthday}
                onCancel={() => { setBdAddingNew(false); setBdNewForm(defaultBdForm()) }}
                saving={bdSaving}
                isNew
              />
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 mt-1"
                onClick={() => setBdAddingNew(true)}
              >
                <Plus className="h-4 w-4" /> Add birthday or anniversary
              </Button>
            )}
          </div>
        )}
      </section>

      {/* Birthday delete confirmation */}
      <Dialog open={!!bdDeletingId} onOpenChange={(o) => !o && setBdDeletingId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove entry?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {bdEntries.find((b) => b.id === bdDeletingId)?.name} will be removed.
          </p>
          <DialogFooter className="gap-2">
            <DialogClose>
              <Button variant="outline" size="sm">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" size="sm" onClick={deleteBirthday}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deletingId} onOpenChange={(o) => !o && setDeletingId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove family member?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {members.find((m) => m.id === deletingId)?.name} will be removed.
            Their tasks will become unassigned.
          </p>
          <DialogFooter className="gap-2">
            <DialogClose>
              <Button variant="outline" size="sm">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" size="sm" onClick={confirmDelete}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 pb-2 border-b">
      <span className="text-muted-foreground">{icon}</span>
      <h2 className="text-base font-semibold">{title}</h2>
    </div>
  )
}

function MemberRow({
  member,
  onEdit,
  onDelete,
}: {
  member: Member
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border rounded-xl bg-background hover:bg-muted/30 transition-colors">
      <span className="text-2xl leading-none shrink-0">{member.avatar_emoji ?? "🧑"}</span>
      <div
        className="w-3 h-3 rounded-full shrink-0"
        style={{ backgroundColor: member.color ?? "#6366f1" }}
      />
      <span className="font-medium flex-1 truncate">{member.name}</span>
      {member.is_child && (
        <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
          Child
        </span>
      )}
      <div className="flex gap-1 shrink-0">
        <button
          onClick={onEdit}
          className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Edit"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          title="Remove"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function BdEntryRow({
  entry,
  onEdit,
  onDelete,
}: {
  entry: BdEntry
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border rounded-xl bg-background hover:bg-muted/30 transition-colors">
      <span className="text-2xl leading-none shrink-0">{entry.type === "birthday" ? "🎂" : "❤️"}</span>
      <div
        className="w-3 h-3 rounded-full shrink-0"
        style={{ backgroundColor: entry.color }}
      />
      <span className="font-medium flex-1 truncate">{entry.name}</span>
      <span className="text-sm text-muted-foreground shrink-0">{formatBdDate(entry.date)}</span>
      <div className="flex gap-1 shrink-0">
        <button
          onClick={onEdit}
          className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Edit"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          title="Remove"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function BdEditRow({
  form,
  onChange,
  onSave,
  onCancel,
  saving,
  isNew = false,
}: {
  form: BdForm
  onChange: (f: BdForm) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  isNew?: boolean
}) {
  const DAY_COUNTS = [31,29,31,30,31,30,31,31,30,31,30,31]
  const daysInMonth = DAY_COUNTS[form.month - 1] ?? 31
  return (
    <div className="border rounded-xl p-3 space-y-3 bg-muted/20">
      {/* Name + cancel */}
      <div className="flex items-center gap-2">
        <Input
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && onSave()}
          placeholder="Name"
          className="flex-1 h-9"
          autoFocus={isNew}
        />
        <button
          type="button"
          onClick={onCancel}
          className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Month + Day selects */}
      <div className="flex gap-2">
        <select
          value={form.month}
          onChange={(e) => onChange({ ...form, month: Number(e.target.value), day: Math.min(form.day, DAY_COUNTS[Number(e.target.value)-1] ?? 31) })}
          className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring flex-1"
        >
          {MONTH_NAMES.map((mn, idx) => (
            <option key={idx+1} value={idx+1}>{mn}</option>
          ))}
        </select>
        <select
          value={form.day}
          onChange={(e) => onChange({ ...form, day: Number(e.target.value) })}
          className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring w-20"
        >
          {Array.from({ length: daysInMonth }, (_, i) => i+1).map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {/* Type toggle */}
      <div className="flex gap-2">
        {(["birthday","anniversary"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange({ ...form, type: t })}
            className={cn(
              "flex-1 h-9 rounded-lg border text-sm font-medium transition-colors",
              form.type === t
                ? "bg-primary text-primary-foreground border-primary"
                : "border-input hover:bg-muted",
            )}
          >
            {t === "birthday" ? "🎂 Birthday" : "❤️ Anniversary"}
          </button>
        ))}
      </div>

      {/* Colour swatches + save */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap flex-1">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ ...form, color: c })}
              className={cn(
                "w-5 h-5 rounded-full border-2 transition-transform hover:scale-110",
                form.color === c ? "border-foreground scale-110" : "border-transparent",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <Button
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={onSave}
          disabled={saving || !form.name.trim()}
        >
          {saving
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Check className="h-3.5 w-3.5" />}
          {isNew ? "Add" : "Save"}
        </Button>
      </div>
    </div>
  )
}

function MemberEditRow({
  form,
  onChange,
  showEmoji,
  onToggleEmoji,
  onSave,
  onCancel,
  saving,
  isNew = false,
}: {
  form: MemberForm
  onChange: (f: MemberForm) => void
  showEmoji: boolean
  onToggleEmoji: () => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  isNew?: boolean
}) {
  return (
    <div className="border rounded-xl p-3 space-y-3 bg-muted/20">
      {/* Name row */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleEmoji}
          className="text-2xl leading-none w-9 h-9 flex items-center justify-center rounded-lg border hover:bg-muted transition-colors shrink-0"
          title="Choose emoji"
        >
          {form.avatar_emoji}
        </button>
        <Input
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && onSave()}
          placeholder="Name"
          className="flex-1 h-9"
          autoFocus={isNew}
        />
        <button
          type="button"
          onClick={onCancel}
          className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Emoji picker */}
      {showEmoji && (
        <div className="flex flex-wrap gap-1.5">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => { onChange({ ...form, avatar_emoji: e }); onToggleEmoji() }}
              className={cn(
                "text-xl leading-none w-8 h-8 flex items-center justify-center rounded-lg border transition-colors",
                form.avatar_emoji === e
                  ? "border-primary bg-primary/10"
                  : "border-transparent hover:bg-muted",
              )}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {/* Colour + is_child + save */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap flex-1">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ ...form, color: c })}
              className={cn(
                "w-5 h-5 rounded-full border-2 transition-transform hover:scale-110",
                form.color === c ? "border-foreground scale-110" : "border-transparent",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={form.is_child}
            onChange={(e) => onChange({ ...form, is_child: e.target.checked })}
            className="rounded"
          />
          Child
        </label>
        <Button
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={onSave}
          disabled={saving || !form.name.trim()}
        >
          {saving
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Check className="h-3.5 w-3.5" />}
          {isNew ? "Add" : "Save"}
        </Button>
      </div>
    </div>
  )
}
