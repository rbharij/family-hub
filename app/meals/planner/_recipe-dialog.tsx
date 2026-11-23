"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Clock, Users, Gauge, Loader2, RefreshCw, Lock, LockOpen, BookmarkPlus, Snowflake, Sunrise, Lightbulb, ChefHat, Shuffle, Check, X,
} from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  SLOT_LABELS, SOURCE_LABELS, LUNCH_KIND_LABELS, PROTEIN_LABELS, weekdayIndex, sourceDinnerDate,
  type PlannedMeal, type RecipeDetail, type SlotKey, type LunchKind,
} from "@/lib/meal-planner"
import { DAY_FULL } from "../_utils"

const EFFORT_LABEL: Record<string, string> = { easy: "Easy", medium: "Medium", ambitious: "Ambitious" }

export function RecipeDialog({
  open, onClose, weekStart, date, slot, meal, lunchKind, busy, onChoose, onMoreOptions, onToggleLock, onSaveRecipe, onFreeze, onClear,
}: {
  open: boolean
  onClose: () => void
  weekStart: string
  date: string
  slot: SlotKey
  meal: PlannedMeal | null
  lunchKind?: LunchKind
  busy: boolean
  onChoose: (index: number) => void
  onMoreOptions: (hint?: string) => void
  onToggleLock: () => void
  onSaveRecipe: (recipe: RecipeDetail | null) => void
  onFreeze: () => void
  onClear: () => void
}) {
  const [hint, setHint] = useState("")
  const [recipe, setRecipe]   = useState<RecipeDetail | null>(meal?.recipe ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async (refresh = false) => {
    setLoading(true); setError(null)
    try {
      const res  = await fetch("/api/meal-plan/recipe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekStart, date, slot, refresh }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Something went wrong")
      setRecipe(data.recipe)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the recipe")
    } finally {
      setLoading(false)
    }
  }, [weekStart, date, slot])

  // Use the cached recipe if there is one, otherwise ask Claude to write it.
  // Re-runs when the meal changes (e.g. after choosing another option).
  const mealTitle = meal?.title
  const cached    = meal?.recipe ?? null
  const requested = useRef<string | null>(null)
  useEffect(() => {
    if (!open) { requested.current = null; return }
    if (!mealTitle) return
    if (cached) { setRecipe(cached); setError(null); return }
    const key = `${date}|${slot}|${mealTitle}`
    if (requested.current === key) return   // already asked for this meal
    requested.current = key
    setRecipe(null)
    load(false)
  }, [open, mealTitle, cached, date, slot, load])

  if (!meal) return null

  const effort  = recipe?.effort ?? meal.effort
  const prep    = recipe?.prep_minutes ?? null
  const cook    = recipe?.cook_minutes ?? meal.cook_minutes ?? null
  const total   = (prep ?? 0) + (cook ?? 0)
  const ingredients = recipe?.ingredients?.length ? recipe.ingredients : (meal.ingredients ?? [])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {SLOT_LABELS[slot]}
            {slot === "lunchbox" && lunchKind ? ` · ${LUNCH_KIND_LABELS[lunchKind]}` : ""}
            {" · "}{DAY_FULL[weekdayIndex(date)]}
          </p>
          <DialogTitle className="font-display text-[26px] font-semibold leading-tight">{meal.title}</DialogTitle>
        </DialogHeader>

        {/* ── Options ─────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border p-3 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-[17px] font-semibold">Options</h3>
            {meal.locked ? (
              <span className="text-[12.5px] text-muted-foreground">Locked. Unlock to change it.</span>
            ) : slot === "dinner" && (meal.extra_for_lunchbox || meal.extra_for_car_dinner) ? (
              <span className="text-[12.5px] text-muted-foreground">Changing this also updates the lunchbox or car dinner made from it.</span>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <OptionCard meal={meal} chosen />
            {(meal.alternatives ?? []).map((alt, i) => (
              <OptionCard
                key={`${alt.title}-${i}`}
                meal={alt}
                disabled={busy || meal.locked}
                onChoose={() => onChoose(i)}
              />
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !busy && !meal.locked) onMoreOptions(hint.trim() || undefined) }}
              placeholder="Want something specific? e.g. vegetarian, quicker, no rice"
              className="flex-1 h-10 rounded-lg border border-input bg-background px-3 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button variant="outline" className="rounded-xl gap-2 h-10" onClick={() => onMoreOptions(hint.trim() || undefined)} disabled={busy || meal.locked}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Shuffle className="size-4" />}
              {busy ? "Thinking…" : "Show 3 new ideas"}
            </Button>
          </div>
        </section>

        {/* ── At a glance ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat icon={<Gauge className="size-4" />} label="Effort" value={effort ? EFFORT_LABEL[effort] : "-"} />
          <Stat icon={<Clock className="size-4" />} label="Prep" value={prep != null ? `${prep} min` : loading ? "…" : "-"} />
          <Stat icon={<ChefHat className="size-4" />} label="Cook" value={cook != null ? `${cook} min` : "-"} />
          <Stat icon={<Users className="size-4" />} label="Serves" value={recipe ? String(recipe.serves) : loading ? "…" : "-"} />
        </div>

        {(recipe?.effort_note || total > 0 || meal.source !== "fresh" || meal.protein) && (
          <div className="flex flex-wrap gap-1.5">
            {meal.protein && <Pill>{PROTEIN_LABELS[meal.protein]}</Pill>}
            {sourceDinnerDate(date, meal) && (
              <Pill>Made from {DAY_FULL[weekdayIndex(sourceDinnerDate(date, meal)!)]}&apos;s dinner</Pill>
            )}
            {meal.source && meal.source !== "fresh" && (
              <Pill>
                {meal.source === "cook_morning" && <Sunrise className="size-3.5" />}
                {meal.source === "freezer" && <Snowflake className="size-3.5" />}
                {SOURCE_LABELS[meal.source]}
              </Pill>
            )}
            {total > 0 && <Pill><Clock className="size-3.5" /> {total} min in total</Pill>}
            {meal.extra_for_lunchbox && <Pill>Make extra for lunchboxes</Pill>}
            {meal.extra_for_car_dinner && <Pill>Extra portion for the car dinner</Pill>}
            {meal.freeze_portions ? <Pill>Cook double · freeze {meal.freeze_portions}</Pill> : null}
          </div>
        )}
        {recipe?.effort_note && <p className="text-[14.5px] text-muted-foreground -mt-1">{recipe.effort_note}</p>}
        {meal.notes && <p className="text-[14.5px]">{meal.notes}</p>}

        {/* ── Ingredients + method ────────────────────────────────────── */}
        <div className="grid gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <section>
            <h3 className="font-display text-[18px] font-semibold mb-2">Ingredients</h3>
            {ingredients.length === 0 ? (
              <p className="text-muted-foreground text-[14px]">{loading ? "Loading…" : "Nothing to buy for this one."}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border text-[14.5px]">
                {ingredients.map((i, idx) => (
                  <li key={idx} className="flex justify-between gap-3 py-1.5">
                    <span className="min-w-0">{i.name}</span>
                    {i.qty && <span className="text-muted-foreground shrink-0 tabular-nums">{i.qty}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="font-display text-[18px] font-semibold mb-2">Method</h3>
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-[14.5px] py-4">
                <Loader2 className="size-4 animate-spin" /> Writing the recipe…
              </div>
            ) : error ? (
              <div className="flex flex-col items-start gap-2">
                <p className="text-destructive text-[14px]">{error}</p>
                <Button variant="outline" size="sm" onClick={() => load(false)}>Try again</Button>
              </div>
            ) : recipe ? (
              <ol className="flex flex-col gap-3">
                {recipe.steps.map((step, idx) => (
                  <li key={idx} className="flex gap-3 text-[14.5px] leading-relaxed">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[12px] font-semibold">{idx + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            ) : null}

            {recipe?.tips && recipe.tips.length > 0 && (
              <div className="mt-4 rounded-2xl bg-accent text-accent-foreground px-4 py-3">
                <p className="flex items-center gap-1.5 text-[13px] font-semibold mb-1"><Lightbulb className="size-4" /> Tips</p>
                <ul className="list-disc pl-5 text-[14px] space-y-0.5">
                  {recipe.tips.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
            )}
          </section>
        </div>

        {/* ── Actions ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          <Button variant="outline" className="rounded-xl gap-2" onClick={onToggleLock}>
            {meal.locked ? <><LockOpen className="size-4" /> Unlock</> : <><Lock className="size-4" /> Lock this meal</>}
          </Button>
          {slot === "dinner" && meal.freeze_portions ? (
            <Button variant="outline" className="rounded-xl gap-2" onClick={onFreeze} disabled={meal.frozen_done}>
              <Snowflake className="size-4" /> {meal.frozen_done ? "Extra portions frozen" : `Add ${meal.freeze_portions} to freezer`}
            </Button>
          ) : null}
          <Button variant="outline" className="rounded-xl gap-2" onClick={() => onSaveRecipe(recipe)} disabled={!recipe}>
            <BookmarkPlus className="size-4" /> Save to recipes
          </Button>
          <Button variant="outline" className="rounded-xl gap-2 text-destructive" onClick={onClear} disabled={busy}>
            <X className="size-4" /> {slot === "dinner" || slot === "lunch" ? "Clear: eating out" : "Clear: not needed"}
          </Button>
          <Button variant="ghost" className="rounded-xl gap-2 ml-auto text-muted-foreground" onClick={() => load(true)} disabled={loading}>
            <RefreshCw className="size-4" /> Rewrite recipe
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-secondary px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{icon}{label}</p>
      <p className="font-display text-[19px] font-semibold mt-0.5">{value}</p>
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[13px] font-medium")}>
      {children}
    </span>
  )
}

function OptionCard({ meal, chosen = false, disabled, onChoose }: {
  meal: PlannedMeal; chosen?: boolean; disabled?: boolean; onChoose?: () => void
}) {
  return (
    <div className={cn(
      "rounded-xl border p-3 flex flex-col gap-1.5 min-w-0",
      chosen ? "border-primary bg-primary/5" : "border-border bg-background",
    )}>
      <p className="font-semibold text-[14.5px] leading-snug">{meal.title}</p>
      <p className="text-[12.5px] text-muted-foreground">
        {[
          meal.cook_minutes ? `${meal.cook_minutes} min` : null,
          meal.effort ? EFFORT_LABEL[meal.effort] : null,
          meal.protein ? PROTEIN_LABELS[meal.protein] : null,
          meal.source && meal.source !== "fresh" ? SOURCE_LABELS[meal.source] : null,
        ].filter(Boolean).join(" · ")}
      </p>
      {meal.notes && <p className="text-[12.5px] leading-snug line-clamp-3">{meal.notes}</p>}
      <div className="mt-auto pt-1">
        {chosen ? (
          <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary"><Check className="size-3.5" /> Chosen</span>
        ) : (
          <Button size="sm" variant="outline" className="rounded-lg" onClick={onChoose} disabled={disabled}>Choose this</Button>
        )}
      </div>
    </div>
  )
}
