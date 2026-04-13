"use client"

import { useEffect, useRef, useState } from "react"
import { Pencil, Trash2, X, Loader2, Plus, MapPin, AlignLeft, Clock } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import type { CalEvent } from "./_utils"

// ── Types ──────────────────────────────────────────────────────────────────────

export type SheetMode = "view" | "edit" | "create"

interface EventSheetProps {
  event: CalEvent | null       // null = create mode
  open: boolean
  onClose: () => void
  onSaved?: () => void         // called after a successful save/delete
}

// ── Colour / Category config ───────────────────────────────────────────────────

const COLOR_CATEGORIES: { color: string; defaultName: string }[] = [
  { color: "#534AB7", defaultName: "School" },
  { color: "#3b82f6", defaultName: "Work" },
  { color: "#10b981", defaultName: "Sport" },
  { color: "#f59e0b", defaultName: "Appointments" },
  { color: "#ef4444", defaultName: "Important" },
  { color: "#ec4899", defaultName: "Family" },
  { color: "#8b5cf6", defaultName: "Social" },
  { color: "#14b8a6", defaultName: "Other" },
]

const PRESET_COLORS = COLOR_CATEGORIES.map((c) => c.color)
const SETTINGS_KEY  = "color_categories"

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Format a timestamptz for <input type="datetime-local"> */
function toDateTimeInput(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

/** Format an ISO string for <input type="date"> */
function toDateInput(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toISOString().slice(0, 10)
}

/** Format datetime for display */
function formatDisplay(iso: string | null, allDay = false): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (allDay) {
    return d.toLocaleDateString("en-AU", {
      weekday: "short", day: "numeric", month: "short", year: "numeric",
    })
  }
  return d.toLocaleString("en-AU", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

// ── Form state ─────────────────────────────────────────────────────────────────

interface EventForm {
  title: string
  description: string
  location: string
  is_all_day: boolean
  start_date: string       // YYYY-MM-DD  (used when all-day)
  end_date: string         // YYYY-MM-DD  (used when all-day)
  start_at: string         // datetime-local value (used when not all-day)
  end_at: string           // datetime-local value (used when not all-day)
  color: string
}

function emptyForm(): EventForm {
  const now = new Date()
  now.setMinutes(0, 0, 0)
  const later = new Date(now)
  later.setHours(later.getHours() + 1)
  const today = now.toISOString().slice(0, 10)
  return {
    title: "",
    description: "",
    location: "",
    is_all_day: false,
    start_date: today,
    end_date: today,
    start_at: toDateTimeInput(now.toISOString()),
    end_at: toDateTimeInput(later.toISOString()),
    color: "#534AB7",
  }
}

function eventToForm(e: CalEvent): EventForm {
  return {
    title: e.title,
    description: e.description ?? "",
    location: e.location ?? "",
    is_all_day: e.is_all_day,
    start_date: toDateInput(e.start_at),
    end_date: toDateInput(e.end_at ?? e.start_at),
    start_at: toDateTimeInput(e.start_at),
    end_at: toDateTimeInput(e.end_at),
    color: e.color ?? "#534AB7",
  }
}

/** Build the ISO strings to persist from the form */
function formToPayload(form: EventForm) {
  let start_at: string
  let end_at: string | null

  if (form.is_all_day) {
    // All-day: store as midnight UTC on the chosen date
    start_at = new Date(form.start_date + "T00:00:00Z").toISOString()
    end_at   = form.end_date
      ? new Date(form.end_date + "T23:59:59Z").toISOString()
      : null
  } else {
    start_at = new Date(form.start_at).toISOString()
    end_at   = form.end_at ? new Date(form.end_at).toISOString() : null
  }

  return {
    title:       form.title.trim(),
    description: form.description.trim() || null,
    location:    form.location.trim() || null,
    is_all_day:  form.is_all_day,
    start_at,
    end_at,
    color:       form.color,
    // Stamp updated_at so Google sync conflict resolution knows this version is fresh
    updated_at:  new Date().toISOString(),
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function EventSheet({ event, open, onClose, onSaved }: EventSheetProps) {
  const isCreate = event === null
  const [mode, setMode]           = useState<SheetMode>(isCreate ? "create" : "view")
  const [form, setForm]           = useState<EventForm>(isCreate ? emptyForm() : eventToForm(event!))
  const [saving, setSaving]       = useState(false)
  const [deleting, setDeleting]   = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  // Category names: color hex → label
  const [categoryNames, setCategoryNames] = useState<Record<string, string>>({})
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const supabase = createClient()

  // ── Load category names from app_settings ─────────────────────────────────

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value && typeof data.value === "object") {
          setCategoryNames(data.value as Record<string, string>)
        }
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Save category names (debounced) ───────────────────────────────────────

  function saveCategoryNames(names: Record<string, string>) {
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    saveTimeout.current = setTimeout(async () => {
      await supabase
        .from("app_settings")
        .upsert({ key: SETTINGS_KEY, value: names }, { onConflict: "key" })
    }, 600)
  }

  function updateCategoryName(color: string, name: string) {
    const updated = { ...categoryNames, [color]: name }
    setCategoryNames(updated)
    saveCategoryNames(updated)
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function getCategoryName(color: string | null): string | null {
    if (!color) return null
    const preset = COLOR_CATEGORIES.find((c) => c.color === color)
    return categoryNames[color] ?? preset?.defaultName ?? null
  }

  // Reset when the sheet opens/event changes
  useEffect(() => {
    if (open) {
      setMode(isCreate ? "create" : "view")
      setForm(isCreate ? emptyForm() : eventToForm(event!))
      setError(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id])

  function patch(updates: Partial<EventForm>) {
    setForm((f) => ({ ...f, ...updates }))
  }

  // When toggling all-day on, sync date fields from datetime fields
  function toggleAllDay(allDay: boolean) {
    if (allDay) {
      patch({
        is_all_day: true,
        start_date: form.start_at.slice(0, 10),
        end_date:   form.end_at.slice(0, 10) || form.start_at.slice(0, 10),
      })
    } else {
      // Restore datetime from date fields
      const now = new Date()
      now.setMinutes(0, 0, 0)
      const later = new Date(now)
      later.setHours(later.getHours() + 1)
      patch({
        is_all_day: false,
        start_at: form.start_date
          ? `${form.start_date}T${toDateTimeInput(now.toISOString()).slice(11)}`
          : toDateTimeInput(now.toISOString()),
        end_at: form.end_date
          ? `${form.end_date}T${toDateTimeInput(later.toISOString()).slice(11)}`
          : toDateTimeInput(later.toISOString()),
      })
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.title.trim()) { setError("Title is required."); return }
    setSaving(true)
    setError(null)

    const payload = formToPayload(form)

    try {
      if (isCreate) {
        const { data: inserted, error } = await supabase
          .from("events")
          .insert(payload)
          .select("id")
          .single()
        if (error) throw error

        // Push to Google Calendar (best-effort)
        try {
          const res = await fetch("/api/google-calendar/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
          if (res.ok) {
            const { google_event_id } = await res.json()
            if (google_event_id) {
              await supabase
                .from("events")
                .update({ google_event_id })
                .eq("id", inserted.id)
            }
          }
        } catch { /* best-effort */ }
      } else {
        const { error } = await supabase
          .from("events")
          .update(payload)
          .eq("id", event!.id)
        if (error) throw error

        if (event!.google_event_id) {
          await fetch("/api/google-calendar/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ google_event_id: event!.google_event_id, ...payload }),
          })
        }
      }
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.")
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!event) return
    setDeleting(true)
    setError(null)
    try {
      const { error } = await supabase.from("events").delete().eq("id", event.id)
      if (error) throw error

      if (event.google_event_id) {
        try {
          await fetch("/api/google-calendar/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ google_event_id: event.google_event_id }),
          })
        } catch { /* best-effort */ }
      }

      setConfirmOpen(false)
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.")
    } finally {
      setDeleting(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const isEditing  = mode === "edit" || mode === "create"
  const sheetTitle = mode === "create" ? "New Event" : mode === "edit" ? "Edit Event" : (event?.title ?? "")
  const eventCategory = getCategoryName(event?.color ?? null)

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent
          side="right"
          className="flex flex-col gap-0 p-0 w-full sm:max-w-md"
        >
          {/* Header */}
          <SheetHeader className="flex-row items-center justify-between px-5 py-4 border-b shrink-0">
            <SheetTitle className="text-base truncate pr-2">{sheetTitle}</SheetTitle>
            <div className="flex items-center gap-1 shrink-0">
              {!isCreate && mode === "view" && (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMode("edit")}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              {!isCreate && (
                <Button
                  variant="ghost" size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => setConfirmOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              <SheetClose
                className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </SheetClose>
            </div>
          </SheetHeader>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

            {/* View mode: colour + category + sync badge */}
            {!isEditing && event && (
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: event.color ?? "#534AB7" }}
                />
                <span className="text-sm font-medium" style={{ color: event.color ?? undefined }}>
                  {eventCategory ?? "Uncategorised"}
                </span>
                <span className="text-xs text-muted-foreground">
                  · {event.google_event_id ? "Synced from Google Calendar" : "Manual event"}
                </span>
              </div>
            )}

            {/* ── Title ───────────────────────────────────────────────────── */}
            {isEditing ? (
              <div className="space-y-1.5">
                <Label htmlFor="ev-title">Title *</Label>
                <Input
                  id="ev-title"
                  value={form.title}
                  onChange={(e) => patch({ title: e.target.value })}
                  placeholder="Add title"
                  className="text-base h-10"
                  autoFocus
                />
              </div>
            ) : (
              <p className="text-lg font-semibold">{event?.title}</p>
            )}

            {/* ── All-day toggle ───────────────────────────────────────────── */}
            {isEditing ? (
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <div
                  onClick={() => toggleAllDay(!form.is_all_day)}
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer",
                    form.is_all_day ? "bg-primary" : "bg-input",
                  )}
                >
                  <span className={cn(
                    "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg transition-transform",
                    form.is_all_day ? "translate-x-4" : "translate-x-0",
                  )} />
                </div>
                <span className="text-sm font-medium">All day</span>
              </label>
            ) : event?.is_all_day ? (
              <p className="text-xs text-muted-foreground">All-day event</p>
            ) : null}

            {/* ── Date / Time ──────────────────────────────────────────────── */}
            {isEditing ? (
              form.is_all_day ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ev-start-date">Start date</Label>
                    <Input
                      id="ev-start-date"
                      type="date"
                      value={form.start_date}
                      onChange={(e) => patch({ start_date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ev-end-date">End date</Label>
                    <Input
                      id="ev-end-date"
                      type="date"
                      value={form.end_date}
                      min={form.start_date}
                      onChange={(e) => patch({ end_date: e.target.value })}
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ev-start">Start</Label>
                    <Input
                      id="ev-start"
                      type="datetime-local"
                      value={form.start_at}
                      onChange={(e) => patch({ start_at: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ev-end">End</Label>
                    <Input
                      id="ev-end"
                      type="datetime-local"
                      value={form.end_at}
                      min={form.start_at}
                      onChange={(e) => patch({ end_at: e.target.value })}
                    />
                  </div>
                </div>
              )
            ) : (
              <div className="flex items-start gap-2.5 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p>{formatDisplay(event?.start_at ?? null, event?.is_all_day)}</p>
                  {event?.end_at && (
                    <p className="text-muted-foreground mt-0.5">
                      → {formatDisplay(event.end_at, event.is_all_day)}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ── Location ─────────────────────────────────────────────────── */}
            {isEditing ? (
              <div className="space-y-1.5">
                <Label htmlFor="ev-location">Location</Label>
                <div className="relative">
                  <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="ev-location"
                    value={form.location}
                    onChange={(e) => patch({ location: e.target.value })}
                    placeholder="Add location"
                    className="pl-8"
                  />
                </div>
              </div>
            ) : event?.location ? (
              <div className="flex items-start gap-2.5 text-sm">
                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <p>{event.location}</p>
              </div>
            ) : null}

            {/* ── Description ──────────────────────────────────────────────── */}
            {isEditing ? (
              <div className="space-y-1.5">
                <Label htmlFor="ev-desc">Description</Label>
                <div className="relative">
                  <AlignLeft className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Textarea
                    id="ev-desc"
                    value={form.description}
                    onChange={(e) => patch({ description: e.target.value })}
                    placeholder="Add description"
                    rows={3}
                    className="pl-8"
                  />
                </div>
              </div>
            ) : event?.description ? (
              <div className="flex items-start gap-2.5 text-sm">
                <AlignLeft className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="whitespace-pre-wrap">{event.description}</p>
              </div>
            ) : null}

            {/* ── Colour & Category ─────────────────────────────────────────── */}
            {isEditing && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Colour &amp; Category</Label>
                  <span className="text-xs text-muted-foreground">Click a colour to select · edit name to rename</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {COLOR_CATEGORIES.map(({ color, defaultName }) => {
                    const name      = categoryNames[color] ?? defaultName
                    const isSelected = form.color === color
                    return (
                      <div
                        key={color}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border-2 px-2.5 py-2 transition-all",
                          isSelected
                            ? "border-foreground bg-muted/60 shadow-sm"
                            : "border-transparent bg-muted/30 hover:border-muted-foreground/30 cursor-pointer",
                        )}
                        onClick={() => patch({ color })}
                      >
                        <span
                          className={cn(
                            "shrink-0 rounded-full transition-all",
                            isSelected ? "w-5 h-5" : "w-4 h-4",
                          )}
                          style={{ backgroundColor: color }}
                        />
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => updateCategoryName(color, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 min-w-0 text-sm bg-transparent outline-none border-b border-transparent focus:border-muted-foreground/40 transition-colors"
                          placeholder={defaultName}
                          maxLength={24}
                        />
                      </div>
                    )
                  })}
                </div>

                {/* Custom colour */}
                <div className="flex items-center gap-2 mt-1">
                  <div className="relative flex items-center">
                    <input
                      type="color"
                      value={form.color}
                      onChange={(e) => patch({ color: e.target.value })}
                      className="absolute inset-0 opacity-0 w-8 h-8 cursor-pointer"
                      title="Custom colour"
                    />
                    <span
                      className={cn(
                        "w-8 h-8 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all",
                        !PRESET_COLORS.includes(form.color)
                          ? "border-foreground scale-110"
                          : "border-dashed border-muted-foreground",
                      )}
                      style={{ backgroundColor: !PRESET_COLORS.includes(form.color) ? form.color : "transparent" }}
                    >
                      {PRESET_COLORS.includes(form.color) ? "+" : ""}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">Custom colour</span>
                  {!PRESET_COLORS.includes(form.color) && (
                    <span className="text-xs font-mono text-muted-foreground">{form.color}</span>
                  )}
                </div>
              </div>
            )}

            {/* Error */}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          {/* Footer */}
          {isEditing && (
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t shrink-0">
              {mode === "edit" && (
                <Button variant="outline" size="sm" onClick={() => setMode("view")}>
                  Cancel
                </Button>
              )}
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                {isCreate ? "Create" : "Save"}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete event?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            &ldquo;{event?.title}&rdquo; will be permanently removed. This cannot be undone.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2">
            <DialogClose>
              <Button variant="outline" size="sm">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Standalone trigger for the header Create button ───────────────────────────

export function CreateEventButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" className="h-8 gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">New Event</span>
      </Button>
      <EventSheet event={null} open={open} onClose={() => setOpen(false)} />
    </>
  )
}
