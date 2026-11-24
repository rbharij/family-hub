"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Clock, Loader2, RefreshCw, Lock, LockOpen, BookmarkPlus, Snowflake, Sunrise, Shuffle, Check, X, BookOpen, ExternalLink, Search,
} from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  SLOT_LABELS, SOURCE_LABELS, LUNCH_KIND_LABELS, PROTEIN_LABELS, weekdayIndex, sourceDinnerDate,
  type PlannedMeal, type RecipeDetail, type SlotKey, type LunchKind,
} from "@/lib/meal-planner"
import { DAY_FULL } from "../_utils"
import { RecipeBody, EFFORT_LABEL } from "../_recipe-body"
import { createClient } from "@/lib/supabase"

export function RecipeDialog({
  open, onClose, weekStart, date, slot, meal, lunchKind, busy, onChoose, onMoreOptions, onToggleLock, onSaveRecipe, onFreeze, onClear, onUseRecipe,
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
  onUseRecipe: (recipeId: string) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [hint, setHint] = useState("")
  const [recipe, setRecipe]   = useState<RecipeDetail | null>(meal?.recipe ?? null)
  // Close the recipe picker whenever another meal is shown
  useEffect(() => { setPickerOpen(false) }, [meal?.title, open])
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

  // Show the saved method if there is one. Nothing is written until the
  // family presses "Write the method". Resets when the meal changes.
  const mealTitle = meal?.title
  const cached    = meal?.recipe ?? null
  useEffect(() => {
    if (!open || !mealTitle) return
    setRecipe(cached)
    setError(null)
  }, [open, mealTitle, cached])

  if (!meal) return null

  const prep    = recipe?.prep_minutes ?? null
  const cook    = recipe?.cook_minutes ?? meal.cook_minutes ?? null
  const total   = (prep ?? 0) + (cook ?? 0)

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
          {pickerOpen && (
            <SavedRecipePicker
              disabled={busy || Boolean(meal.locked)}
              currentRecipeId={meal.recipe_id ?? null}
              onPick={(id) => { onUseRecipe(id); setPickerOpen(false) }}
              onClose={() => setPickerOpen(false)}
            />
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              variant={pickerOpen ? "secondary" : "outline"}
              className="rounded-xl gap-2 h-10 shrink-0"
              onClick={() => setPickerOpen((o) => !o)}
              disabled={busy || meal.locked}
            >
              <BookOpen className="size-4" /> From saved recipes
            </Button>
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

        <RecipeBody
          recipe={recipe}
          loading={loading}
          error={error}
          onRetry={() => load(false)}
          onGenerate={() => load(false)}
          fallback={{ effort: meal.effort, cook_minutes: meal.cook_minutes, ingredients: meal.ingredients }}
        >
          {(recipe?.effort_note || total > 0 || meal.source !== "fresh" || meal.protein) && (
            <div className="flex flex-wrap gap-1.5">
              {meal.protein && <Pill>{PROTEIN_LABELS[meal.protein]}</Pill>}
              {meal.recipe_id && (
                <Pill>
                  <BookOpen className="size-3.5" /> Your saved recipe
                  {meal.recipe_url && (
                    <a href={meal.recipe_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2">
                      open <ExternalLink className="size-3" />
                    </a>
                  )}
                </Pill>
              )}
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
          {meal.notes && <p className="text-[14.5px]">{meal.notes}</p>}
        </RecipeBody>

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
          <Button variant="outline" className="rounded-xl gap-2" onClick={() => onSaveRecipe(recipe)} disabled={!recipe && !meal.ingredients?.length}>
            <BookmarkPlus className="size-4" /> Save to recipes
          </Button>
          <Button variant="outline" className="rounded-xl gap-2 text-destructive" onClick={onClear} disabled={busy}>
            <X className="size-4" /> {slot === "dinner" || slot === "lunch" ? "Clear: eating out" : "Clear: not needed"}
          </Button>
          {recipe && <Button variant="ghost" className="rounded-xl gap-2 ml-auto text-muted-foreground" onClick={() => load(true)} disabled={loading}>
            <RefreshCw className="size-4" /> Rewrite recipe
          </Button>}
        </div>
      </DialogContent>
    </Dialog>
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

// ── Saved recipe picker ─────────────────────────────────────────────────────

interface SavedRecipe { id: string; title: string; tags: string[]; notes: string | null }

function SavedRecipePicker({ disabled, currentRecipeId, onPick, onClose }: {
  disabled: boolean
  currentRecipeId: string | null
  onPick: (id: string) => void
  onClose: () => void
}) {
  const supabase = useRef(createClient()).current
  const [recipes, setRecipes] = useState<SavedRecipe[] | null>(null)
  const [query, setQuery]     = useState("")

  useEffect(() => {
    supabase.from("recipes").select("id, title, tags, notes").order("title")
      .then(({ data }) => setRecipes((data ?? []) as SavedRecipe[]))
  }, [supabase])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!recipes) return []
    if (!q) return recipes
    return recipes.filter((r) =>
      r.title.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q)))
  }, [recipes, query])

  return (
    <div className="rounded-xl border border-border bg-background p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your recipes or tags…"
            className="w-full h-10 rounded-lg border border-input bg-background pl-9 pr-3 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      <div className="max-h-64 overflow-y-auto flex flex-col divide-y divide-border">
        {recipes === null ? (
          <p className="flex items-center gap-2 text-[14px] text-muted-foreground py-3"><Loader2 className="size-4 animate-spin" /> Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-[14px] text-muted-foreground py-3">
            {recipes.length === 0 ? "No saved recipes yet. Save one from any meal, or add them on the Recipes page." : "No recipes match that search."}
          </p>
        ) : filtered.map((r) => (
          <div key={r.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-semibold truncate">{r.title}</p>
              {r.tags.length > 0 && (
                <p className="text-[12.5px] text-muted-foreground truncate">{r.tags.join(" · ")}</p>
              )}
            </div>
            {r.id === currentRecipeId ? (
              <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary"><Check className="size-3.5" /> Chosen</span>
            ) : (
              <Button size="sm" variant="outline" className="rounded-lg shrink-0" disabled={disabled} onClick={() => onPick(r.id)}>
                Use this
              </Button>
            )}
          </div>
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground">
        Claude fills in the ingredients for your household from the recipe&apos;s notes, and updates any lunchbox or car dinner made from it.
      </p>
    </div>
  )
}
