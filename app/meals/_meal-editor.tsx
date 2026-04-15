"use client"

import { useEffect, useState, useRef } from "react"
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
import { MemberSelector, type FamilyMember } from "@/app/plants/_member-selector"

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
  allChildren?: FamilyMember[] // all child members (for "copy to other kids" feature)
}

// ── Component ──────────────────────────────────────────────────────────────────

export function MealEditor({
  open, onClose, onSaved, meal, date, dayIndex, mealType,
  forMemberId, forMemberName, allChildren = [],
}: MealEditorProps) {
  const [title, setTitle]             = useState("")
  const [notes, setNotes]             = useState("")
  const [schoolLunch, setSchoolLunch] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [clearing, setClearing]       = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [selectedPlants, setSelectedPlants] = useState<Plant[]>([])
  const [members, setMembers]         = useState<FamilyMember[]>([])
  const [eaterIds, setEaterIds]       = useState<string[]>([])
  const [copyToOthers, setCopyToOthers] = useState(false)

  const supabase = useRef(createClient()).current
  const SCHOOL_LUNCH = "School Lunch"

  // Other children this lunchbox could be copied to
  const otherChildren = allChildren.filter((c) => c.id !== forMemberId)

  // For dinner, always log to all members — no selector needed
  const isDinner = mealType === "dinner"

  // ── Load family members once on mount ─────────────────────────────────────

  useEffect(() => {
    supabase
      .from("family_members")
      .select("id, name, avatar_emoji, color")
      .order("created_at")
      .then(({ data }) => setMembers((data ?? []) as FamilyMember[]))
  }, [supabase])

  // ── Reset on open ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return
    const isSchool = meal?.title === SCHOOL_LUNCH
    setSchoolLunch(isSchool)
    setTitle(isSchool ? "" : (meal?.title ?? ""))
    setNotes(meal?.notes ?? "")
    setError(null)
    setCopyToOthers(false)

    if (meal?.id) {
      // Load plants already logged for this meal
      supabase
        .from("member_weekly_plants")
        .select("plant_id, plants!inner(id, name, emoji, category)")
        .eq("meal_id", meal.id)
        .then(({ data }) => {
          if (!data) { setSelectedPlants([]); return }
          const seen = new Set<string>()
          const plants: Plant[] = []
          for (const row of data) {
            const p = row.plants as unknown as Plant
            if (p && !seen.has(p.id)) {
              seen.add(p.id)
              plants.push({ ...p, times_eaten: 0, first_eaten_date: null })
            }
          }
          setSelectedPlants(plants)
        })
    } else {
      setSelectedPlants([])
    }
  }, [open, meal, supabase])

  // ── Default eater selection ────────────────────────────────────────────────
  // Dinner → all members (fixed, no picker shown)
  // Lunchbox (existing meal) → whoever already has plants logged for it
  // Lunchbox (new) → just the child this lunchbox is for

  useEffect(() => {
    if (!open || members.length === 0) return
    if (isDinner) {
      // Always all members for dinner
      setEaterIds(members.map((m) => m.id))
    } else if (meal?.id) {
      supabase
        .from("member_weekly_plants")
        .select("member_id")
        .eq("meal_id", meal.id)
        .then(({ data }) => {
          const ids = Array.from(new Set((data ?? []).map((r) => r.member_id)))
          setEaterIds(ids.length > 0 ? ids : forMemberId ? [forMemberId] : members.map((m) => m.id))
        })
    } else if (forMemberId) {
      setEaterIds([forMemberId])
    } else {
      setEaterIds(members.map((m) => m.id))
    }
  }, [open, meal, members, forMemberId, isDinner, supabase])

  // ── Week start helper ──────────────────────────────────────────────────────

  function mealWeekStart(): string {
    const d = new Date(date + "T00:00:00")
    const day = d.getDay()
    const offset = (day + 6) % 7
    d.setDate(d.getDate() - offset)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  // ── Plant logging helper ───────────────────────────────────────────────────
  // Direct table operations — no RPC dependency.
  // Upsert into member_weekly_plants so the row always exists and meal_id
  // is always stamped, even if the plant was previously logged another way.

  async function logPlantsForMeal(
    plantIds: string[],
    memberIds: string[],
    weekStart: string,
    mealId: string,
  ) {
    for (const plantId of plantIds) {
      for (const memberId of memberIds) {
        // Upsert: inserts if new, updates meal_id + added_by if row exists
        const { error } = await supabase
          .from("member_weekly_plants")
          .upsert(
            { plant_id: plantId, member_id: memberId, week_start: weekStart,
              meal_id: mealId, added_by: "meal" },
            { onConflict: "plant_id,member_id,week_start" },
          )
        if (error) throw new Error(`Could not log plant: ${error.message}`)
      }
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!schoolLunch && !title.trim()) { setError("Please enter a meal title."); return }
    if (!isDinner && selectedPlants.length > 0 && eaterIds.length === 0) {
      setError("Please select who ate these plants."); return
    }
    setSaving(true); setError(null)
    try {
      const mealTitle   = schoolLunch ? SCHOOL_LUNCH : title.trim()
      const mealNotes   = notes.trim() || null
      const weekStart   = mealWeekStart()

      // Effective eaters: dinner → everyone; lunchbox → chosen eaterIds
      const effectiveEaterIds = isDinner ? members.map((m) => m.id) : eaterIds

      // ── Upsert the primary meal record ─────────────────────────────────
      let mealId: string | null = meal?.id ?? null

      if (meal) {
        const { error } = await supabase.from("meals").update({
          date, meal_type: mealType,
          title: mealTitle, notes: mealNotes,
          for_member_id: forMemberId,
        }).eq("id", meal.id)
        if (error) throw error
      } else {
        const { data: newMeal, error } = await supabase.from("meals").insert({
          date, meal_type: mealType,
          title: mealTitle, notes: mealNotes,
          for_member_id: forMemberId,
        }).select("id").single()
        if (error) throw error
        mealId = newMeal?.id ?? null
      }

      // ── Log plants for this meal ────────────────────────────────────────
      if (selectedPlants.length > 0 && effectiveEaterIds.length > 0 && mealId) {
        await logPlantsForMeal(selectedPlants.map(p => p.id), effectiveEaterIds, weekStart, mealId)
      }

      // ── Copy to other kids (lunchbox only) ─────────────────────────────
      if (mealType === "lunchbox" && copyToOthers && otherChildren.length > 0) {
        for (const child of otherChildren) {
          // Check if the child already has a lunchbox for this date
          const { data: existing } = await supabase
            .from("meals")
            .select("id")
            .eq("date", date)
            .eq("meal_type", "lunchbox")
            .eq("for_member_id", child.id)
            .maybeSingle()

          let childMealId: string | null = existing?.id ?? null

          if (!childMealId) {
            const { data: newChildMeal, error: childErr } = await supabase
              .from("meals")
              .insert({
                date, meal_type: "lunchbox",
                title: mealTitle, notes: mealNotes,
                for_member_id: child.id,
              })
              .select("id")
              .single()
            if (childErr) throw childErr
            childMealId = newChildMeal?.id ?? null
          } else {
            // Update existing lunchbox to match
            await supabase.from("meals").update({
              title: mealTitle, notes: mealNotes,
            }).eq("id", childMealId)
          }

          // Log the same plants for this child
          if (selectedPlants.length > 0 && childMealId) {
            await logPlantsForMeal(selectedPlants.map(p => p.id), [child.id], weekStart, childMealId)
          }
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

          {/* Plant picker */}
          <PlantPicker
            selected={selectedPlants}
            onAdd={(p) => setSelectedPlants((prev) => prev.some((x) => x.id === p.id) ? prev : [...prev, p])}
            onRemove={(id) => setSelectedPlants((prev) => prev.filter((x) => x.id !== id))}
          />

          {/* Member selector — lunchbox only, shown when plants are selected */}
          {!isDinner && selectedPlants.length > 0 && members.length > 0 && (
            <MemberSelector
              members={members}
              selected={eaterIds}
              onChange={setEaterIds}
              label="Who ate these plants?"
              required
            />
          )}

          {/* Dinner: plants auto-assigned to everyone — show a hint */}
          {isDinner && selectedPlants.length > 0 && (
            <p className="text-xs text-muted-foreground">
              🌿 Plant foods will be added to everyone&apos;s count.
            </p>
          )}

          {/* Copy to other kids — lunchbox only */}
          {mealType === "lunchbox" && otherChildren.length > 0 && (
            <div className="flex items-center gap-2.5">
              <Checkbox
                id="copy-to-others"
                checked={copyToOthers}
                onCheckedChange={(v) => setCopyToOthers(Boolean(v))}
              />
              <Label htmlFor="copy-to-others" className="cursor-pointer font-medium">
                Also add for {otherChildren.map((c) => c.name).join(" & ")}
              </Label>
            </div>
          )}

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
