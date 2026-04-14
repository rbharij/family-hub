"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase"
import {
  MEAL_LABELS, MEAL_EMOJIS, DAY_FULL,
  type Meal, type MealType,
} from "./_utils"
import { PlantPicker, type Plant } from "@/app/plants/_plant-picker"

// ── Props ──────────────────────────────────────────────────────────────────────

interface MealEditorProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  meal: Meal | null          // null = create mode
  date: string
  dayIndex: number           // 0=Mon…6=Sun
  mealType: MealType
  forMemberId: string | null // set for lunchbox rows
  forMemberName: string | null
}

// ── Component ──────────────────────────────────────────────────────────────────

export function MealEditor({
  open, onClose, onSaved, meal, date, dayIndex, mealType, forMemberId, forMemberName,
}: MealEditorProps) {
  const [title, setTitle]       = useState("")
  const [notes, setNotes]       = useState("")
  const [schoolLunch, setSchoolLunch] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [selectedPlants, setSelectedPlants] = useState<Plant[]>([])

  const supabase = createClient()

  // Reset on open
  const SCHOOL_LUNCH = "School Lunch"

  useEffect(() => {
    if (open) {
      const isSchool = meal?.title === SCHOOL_LUNCH
      setSchoolLunch(isSchool)
      setTitle(isSchool ? "" : (meal?.title ?? ""))
      setNotes(meal?.notes ?? "")
      setError(null)
      setSelectedPlants([])
    }
  }, [open, meal])

  // ── Week start helper ──────────────────────────────────────────────────────

  function mealWeekStart(): string {
    const d = new Date(date + "T00:00:00")
    const day = d.getDay()
    const offset = (day + 6) % 7
    d.setDate(d.getDate() - offset)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!schoolLunch && !title.trim()) { setError("Please enter a meal title."); return }
    setSaving(true); setError(null)
    try {
      const payload = {
        date,
        meal_type: mealType,
        title: schoolLunch ? SCHOOL_LUNCH : title.trim(),
        notes: notes.trim() || null,
        for_member_id: forMemberId,
      }

      let mealId: string | null = meal?.id ?? null

      if (meal) {
        const { error } = await supabase.from("meals").update(payload).eq("id", meal.id)
        if (error) throw error
      } else {
        const { data: newMeal, error } = await supabase.from("meals").insert(payload).select("id").single()
        if (error) throw error
        mealId = newMeal?.id ?? null
      }

      // Log any selected plants for the week
      if (selectedPlants.length > 0) {
        const weekStart = mealWeekStart()
        for (const plant of selectedPlants) {
          await supabase.rpc("log_plant_for_week", {
            p_plant_id:   plant.id,
            p_week_start: weekStart,
            p_added_by:   "meal",
            p_meal_id:    mealId,
          })
        }
      }

      onClose()
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.")
    } finally {
      setSaving(false)
    }
  }

  // ── Clear ──────────────────────────────────────────────────────────────────

  async function handleClear() {
    if (!meal) { onClose(); return }
    setClearing(true)
    await supabase.from("meals").delete().eq("id", meal.id)
    setClearing(false)
    onClose()
    onSaved()
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const headerLabel = mealType === "lunchbox" && forMemberName
    ? `${MEAL_EMOJIS.lunchbox} Lunchbox — ${forMemberName}`
    : `${MEAL_EMOJIS[mealType]} ${MEAL_LABELS[mealType]} — ${DAY_FULL[dayIndex]}`

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{headerLabel}</DialogTitle>
          <p className="text-xs text-muted-foreground">{date}</p>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* School Lunch shortcut — lunchbox only */}
          {mealType === "lunchbox" && (
            <div className="flex items-center gap-2.5">
              <Checkbox
                id="school-lunch"
                checked={schoolLunch}
                onCheckedChange={(v) => {
                  setSchoolLunch(Boolean(v))
                  if (v) setTitle("")
                }}
              />
              <Label htmlFor="school-lunch" className="cursor-pointer font-medium">
                School Lunch
              </Label>
            </div>
          )}

          {!schoolLunch && (
            <div className="space-y-1.5">
              <Label htmlFor="meal-title">
                What&apos;s for {MEAL_LABELS[mealType].toLowerCase()}? *
              </Label>
              <Input
                id="meal-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSave()}
                placeholder={
                  mealType === "dinner"
                    ? "e.g. Spaghetti Bolognese"
                    : "e.g. Ham & cheese sandwich"
                }
                autoFocus={mealType !== "lunchbox"}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="meal-notes">
              Notes <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="meal-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ingredients, prep notes, leftovers…"
              rows={2}
            />
          </div>

          <PlantPicker
            selected={selectedPlants}
            onAdd={(p) => setSelectedPlants((prev) => prev.some((x) => x.id === p.id) ? prev : [...prev, p])}
            onRemove={(id) => setSelectedPlants((prev) => prev.filter((x) => x.id !== id))}
          />

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="flex-row items-center gap-2 sm:gap-2">
          {meal && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive mr-auto"
              onClick={handleClear}
              disabled={clearing || saving}
            >
              {clearing && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Clear
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving || clearing}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || clearing}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {meal ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
