"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Pencil, RefreshCw, BookmarkPlus } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase"
import { addDaysStr, weekdayIndex, type RecipeDetail, type SlotKey, type WeekPlan } from "@/lib/meal-planner"
import { RecipeBody } from "./_recipe-body"
import { SLOT_STYLES } from "./_slot-style"
import { DAY_FULL, type Meal, type MealType } from "./_utils"

function mondayOf(dateStr: string) { return addDaysStr(dateStr, -weekdayIndex(dateStr)) }

/**
 * Read-only view of a meal on the Meals page: how to make it, with a button
 * to edit the meal itself.
 */
export function MealView({ open, onClose, meal, dayIndex, mealType, memberName, onEdit }: {
  open: boolean
  onClose: () => void
  meal: (Meal & { recipe?: RecipeDetail | null }) | null
  dayIndex: number
  mealType: MealType
  memberName: string | null
  onEdit: () => void
}) {
  const supabase = useRef(createClient()).current
  const [recipe, setRecipe]   = useState<RecipeDetail | null>(meal?.recipe ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const requested = useRef<string | null>(null)

  const load = useCallback(async (refresh = false) => {
    if (!meal) return
    setLoading(true); setError(null)
    try {
      const res  = await fetch("/api/meals/recipe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mealId: meal.id, refresh }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Something went wrong")
      setRecipe(data.recipe)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the recipe")
    } finally {
      setLoading(false)
    }
  }, [meal])

  // Use the stored recipe if there is one; otherwise check (without writing
  // anything) whether the meal plan already has one. The method is only
  // written when the family presses "Write the method".
  const key    = meal ? `${meal.id}|${meal.title}` : null
  const stored = meal?.recipe ?? null
  useEffect(() => {
    if (!open) { requested.current = null; return }
    if (!key) return
    if (stored) { setRecipe(stored); setError(null); return }
    if (requested.current === key) return
    requested.current = key
    setRecipe(null)
    setError(null)
    // Check the meal plan for a method already written there (no Claude call)
    const monday = mondayOf(meal!.date)
    supabase.from("meal_plans").select("plan").eq("week_start", monday).maybeSingle()
      .then(({ data }) => {
        const plan = (data as { plan: WeekPlan } | null)?.plan
        const planned = plan?.days.find((d) => d.date === meal!.date)?.[mealType as SlotKey]
        if (planned?.title === meal!.title && planned.recipe) setRecipe(planned.recipe)
      })
  }, [open, key, stored, meal, mealType, supabase])

  async function saveToRecipes() {
    if (!meal || !recipe) return
    const parts = [
      `Serves ${recipe.serves}. Prep ${recipe.prep_minutes ?? "?"} min, cook ${recipe.cook_minutes ?? "?"} min.`,
      `Ingredients:\n${recipe.ingredients.map((i) => `- ${i.qty ? `${i.name} (${i.qty})` : i.name}`).join("\n")}`,
      `Method:\n${recipe.steps.map((s, n) => `${n + 1}. ${s}`).join("\n")}`,
      recipe.tips?.length ? `Tips:\n${recipe.tips.map((t) => `- ${t}`).join("\n")}` : "",
    ].filter(Boolean)
    const { error: err } = await supabase.from("recipes").insert({ title: meal.title, notes: parts.join("\n\n"), tags: [] })
    if (err) toast.error("Couldn't save the recipe")
    else toast.success(`${meal.title} saved to recipes`)
  }

  if (!meal) return null
  const style = SLOT_STYLES[mealType]
  const Icon  = style.icon

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <span className={cn("flex size-5 items-center justify-center rounded-md", style.chip)}><Icon className="size-3" /></span>
            {style.label}{memberName ? ` · ${memberName}` : ""} · {DAY_FULL[dayIndex]}
          </p>
          <DialogTitle className="font-display text-[26px] font-semibold leading-tight">{meal.title}</DialogTitle>
        </DialogHeader>

        <RecipeBody recipe={recipe} loading={loading} error={error} onRetry={() => load(false)} onGenerate={() => load(false)}>
          {meal.notes && <p className="text-[14.5px]">{meal.notes}</p>}
        </RecipeBody>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          <Button className="rounded-xl gap-2" onClick={onEdit}>
            <Pencil className="size-4" /> Edit meal
          </Button>
          <Button variant="outline" className="rounded-xl gap-2" onClick={saveToRecipes} disabled={!recipe}>
            <BookmarkPlus className="size-4" /> Save to recipes
          </Button>
          {recipe && (
            <Button variant="ghost" className="rounded-xl gap-2 ml-auto text-muted-foreground" onClick={() => load(true)} disabled={loading}>
              <RefreshCw className="size-4" /> Rewrite recipe
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
