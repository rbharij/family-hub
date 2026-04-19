"use client"

import { useEffect, useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase"
import {
  expandRecurringDates,
  toDateStr,
  WEEKDAY_LABELS,
  WEEKDAY_JS_DAYS,
  type FamilyMember,
  type Chore,
} from "./_utils"

// ── Types ──────────────────────────────────────────────────────────────────────

interface ChoreSheetProps {
  open: boolean
  onClose: () => void
  members: FamilyMember[]
  chore?: Chore | null
  defaultDate?: string
  defaultMemberId?: string
}

type EditScope = "this" | "future"

interface FormState {
  title: string
  assigned_to: string
  due_date: string
  pocket_money_value: string
  is_recurring: boolean
  recur_days: number[]
}

function emptyForm(defaultDate?: string, defaultMemberId?: string): FormState {
  return {
    title: "",
    assigned_to: defaultMemberId ?? "",
    due_date: defaultDate ?? toDateStr(new Date()),
    pocket_money_value: "0",
    is_recurring: false,
    recur_days: [],
  }
}

function choreToForm(c: Chore): FormState {
  return {
    title: c.title,
    assigned_to: c.assigned_to ?? "",
    due_date: c.due_date ?? toDateStr(new Date()),
    pocket_money_value: String(c.pocket_money_value ?? 0),
    is_recurring: c.is_recurring,
    recur_days: c.recur_days ?? [],
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ChoreSheet({
  open,
  onClose,
  members,
  chore,
  defaultDate,
  defaultMemberId,
}: ChoreSheetProps) {
  const isEdit = Boolean(chore)
  const isSeries = isEdit && chore?.is_recurring && Boolean(chore?.recur_series_id)

  const [form, setForm] = useState<FormState>(
    chore ? choreToForm(chore) : emptyForm(defaultDate, defaultMemberId),
  )
  // When editing a recurring series: "this" = just this instance, "future" = this + all future
  const [editScope, setEditScope] = useState<EditScope>("this")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    if (open) {
      setForm(chore ? choreToForm(chore) : emptyForm(defaultDate, defaultMemberId))
      setEditScope("this")
      setError(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chore?.id])

  function field<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function toggleRecurDay(jsDay: number) {
    setForm((f) => ({
      ...f,
      recur_days: f.recur_days.includes(jsDay)
        ? f.recur_days.filter((d) => d !== jsDay)
        : [...f.recur_days, jsDay],
    }))
  }

  const expandedCount = form.is_recurring && form.recur_days.length > 0
    ? expandRecurringDates(form.recur_days).length
    : 0

  async function handleSave() {
    if (!form.title.trim()) { setError("Title is required."); return }
    if (form.is_recurring && form.recur_days.length === 0) {
      setError("Select at least one day for recurring tasks."); return
    }
    setSaving(true)
    setError(null)

    try {
      const base = {
        title:              form.title.trim(),
        assigned_to:        form.assigned_to || null,
        pocket_money_value: parseFloat(form.pocket_money_value) || 0,
        is_recurring:       form.is_recurring,
        recur_days:         form.is_recurring ? form.recur_days : null,
      }

      if (isEdit && chore) {
        if (isSeries && editScope === "future") {
          // ── Edit all future instances in the series ─────────────────────
          const today = toDateStr(new Date())

          if (form.is_recurring && form.recur_days.length > 0) {
            // Step 1: delete all future instances (they'll be regenerated)
            await supabase
              .from("chores")
              .delete()
              .eq("recur_series_id", chore.recur_series_id!)
              .gte("due_date", today)
              .eq("completed", false)

            // Step 2: regenerate from today with new settings
            const dates = expandRecurringDates(form.recur_days)
            if (dates.length > 0) {
              const rows = dates.map((due_date) => ({
                ...base,
                due_date,
                recur_series_id: chore.recur_series_id,
              }))
              const { error } = await supabase.from("chores").insert(rows)
              if (error) throw error
            }
          } else {
            // Changing from recurring to one-off: just update all future uncompleted
            const { error } = await supabase
              .from("chores")
              .update({ ...base, recur_series_id: null })
              .eq("recur_series_id", chore.recur_series_id!)
              .gte("due_date", today)
              .eq("completed", false)
            if (error) throw error
          }
        } else {
          // ── Edit just this one instance ────────────────────────────────
          const { error } = await supabase
            .from("chores")
            .update({
              ...base,
              due_date: form.due_date,
              // Detach from series if user makes it non-recurring
              recur_series_id: form.is_recurring ? chore.recur_series_id : null,
            })
            .eq("id", chore.id)
          if (error) throw error
        }
      } else if (form.is_recurring) {
        // ── Create recurring series ────────────────────────────────────────
        const dates = expandRecurringDates(form.recur_days)
        if (dates.length === 0) { setError("No upcoming dates found."); setSaving(false); return }

        // Generate a series ID client-side (UUID v4)
        const seriesId = crypto.randomUUID()
        const rows = dates.map((due_date) => ({
          ...base,
          due_date,
          recur_series_id: seriesId,
        }))
        const { error } = await supabase.from("chores").insert(rows)
        if (error) throw error
      } else {
        // ── Create one-off ────────────────────────────────────────────────
        const { error } = await supabase.from("chores").insert({
          ...base,
          due_date: form.due_date || null,
        })
        if (error) throw error
      }

      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0 w-full sm:max-w-md">
        <SheetHeader className="px-5 py-4 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2">
            {isEdit ? "Edit Task" : "New Task"}
            {isSeries && (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground border rounded-full px-2 py-0.5">
                <RefreshCw className="h-3 w-3" /> Recurring
              </span>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

          {/* ── Edit scope (only for existing recurring series) ──────────── */}
          {isSeries && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <p className="text-sm font-medium">Edit scope</p>
              <div className="flex flex-col gap-2">
                {(["this", "future"] as EditScope[]).map((scope) => (
                  <label
                    key={scope}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors",
                      editScope === scope
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50",
                    )}
                  >
                    <input
                      type="radio"
                      name="edit-scope"
                      value={scope}
                      checked={editScope === scope}
                      onChange={() => setEditScope(scope)}
                      className="accent-primary"
                    />
                    <div>
                      <p className="text-sm font-medium">
                        {scope === "this" ? "This task only" : "This and all future tasks"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {scope === "this"
                          ? "Only changes this occurrence"
                          : "Replaces all incomplete future occurrences"}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ── Title ────────────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="chore-title">Title *</Label>
            <Input
              id="chore-title"
              value={form.title}
              onChange={(e) => field("title", e.target.value)}
              placeholder="e.g. Vacuum living room"
              autoFocus
            />
          </div>

          {/* ── Assigned to ──────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label>Assigned to</Label>
            <Select
              value={form.assigned_to ?? ""}
              onValueChange={(v) => field("assigned_to", v ?? "")}
            >
              <SelectTrigger>
                {form.assigned_to
                  ? (() => {
                      const m = members.find((mem) => mem.id === form.assigned_to)
                      return m
                        ? <span>{m.avatar_emoji ?? ""} {m.name}</span>
                        : <span className="text-muted-foreground">Anyone</span>
                    })()
                  : <span className="text-muted-foreground">Anyone</span>}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Anyone</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.avatar_emoji} {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ── Pocket money ─────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="chore-money">Pocket Money</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
                S$
              </span>
              <Input
                id="chore-money"
                type="number"
                min="0"
                step="0.50"
                value={form.pocket_money_value}
                onChange={(e) => field("pocket_money_value", e.target.value)}
                placeholder="0.00"
                className="pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground">Leave at 0 for no pocket money.</p>
          </div>

          {/* ── Recurring toggle (hidden when editing "this only") ────────── */}
          {!(isSeries && editScope === "this") && (
            <div className="flex items-center gap-3">
              <Switch
                id="chore-recurring"
                checked={form.is_recurring}
                onCheckedChange={(v) => field("is_recurring", v)}
              />
              <Label htmlFor="chore-recurring" className="cursor-pointer">
                Recurring task
              </Label>
            </div>
          )}

          {/* ── Day picker (recurring) or due date (one-off) ─────────────── */}
          {form.is_recurring && !(isSeries && editScope === "this") ? (
            <div className="space-y-3">
              <Label>Repeats on</Label>
              <div className="flex gap-2 flex-wrap">
                {WEEKDAY_LABELS.map((label, i) => {
                  const jsDay = WEEKDAY_JS_DAYS[i]
                  const active = form.recur_days.includes(jsDay)
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => toggleRecurDay(jsDay)}
                      className={cn(
                        "w-10 h-10 rounded-full text-xs font-semibold border-2 transition-colors",
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                      )}
                    >
                      {label.slice(0, 2)}
                    </button>
                  )
                })}
              </div>

              {form.recur_days.length > 0 && (
                <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{expandedCount} tasks</span>
                  {" "}will be created over the next 8 weeks on{" "}
                  <span className="font-medium text-foreground">
                    {form.recur_days
                      .map((d) => {
                        const idx = WEEKDAY_JS_DAYS.indexOf(d)
                        return idx >= 0 ? WEEKDAY_LABELS[idx] : ""
                      })
                      .join(", ")}
                  </span>
                </div>
              )}
            </div>
          ) : !(isSeries && editScope === "this" && chore?.is_recurring) ? (
            <div className="space-y-1.5">
              <Label htmlFor="chore-date">Due date</Label>
              <Input
                id="chore-date"
                type="date"
                value={form.due_date}
                onChange={(e) => field("due_date", e.target.value)}
              />
            </div>
          ) : null}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {isEdit
              ? "Save"
              : form.is_recurring && expandedCount > 0
              ? `Create (${expandedCount} tasks)`
              : "Create"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
