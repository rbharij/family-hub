"use client"

import { Clock, Users, Gauge, Loader2, Lightbulb, ChefHat } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { Effort, Ingredient, RecipeDetail } from "@/lib/meal-planner"

export const EFFORT_LABEL: Record<string, string> = { easy: "Easy", medium: "Medium", ambitious: "Ambitious" }

/**
 * Recipe layout shared by the planner and the Meals page: at-a-glance stats,
 * then ingredients beside a numbered method and tips.
 */
export function RecipeBody({
  recipe, loading, error, onRetry, fallback, children,
}: {
  recipe: RecipeDetail | null
  loading: boolean
  error: string | null
  onRetry: () => void
  /** Shown before the full recipe arrives (from the plan, if any) */
  fallback?: { effort?: Effort | null; cook_minutes?: number | null; ingredients?: Ingredient[] }
  /** Rendered between the stats and the ingredients (pills, notes) */
  children?: React.ReactNode
}) {
  const effort = recipe?.effort ?? fallback?.effort ?? null
  const prep   = recipe?.prep_minutes ?? null
  const cook   = recipe?.cook_minutes ?? fallback?.cook_minutes ?? null
  const ingredients = recipe?.ingredients?.length ? recipe.ingredients : (fallback?.ingredients ?? [])

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat icon={<Gauge className="size-4" />} label="Effort" value={effort ? EFFORT_LABEL[effort] : loading ? "…" : "-"} />
        <Stat icon={<Clock className="size-4" />} label="Prep" value={prep != null ? `${prep} min` : loading ? "…" : "-"} />
        <Stat icon={<ChefHat className="size-4" />} label="Cook" value={cook != null ? `${cook} min` : loading ? "…" : "-"} />
        <Stat icon={<Users className="size-4" />} label="Serves" value={recipe ? String(recipe.serves) : loading ? "…" : "-"} />
      </div>

      {children}
      {recipe?.effort_note && <p className="text-[14.5px] text-muted-foreground -mt-1">{recipe.effort_note}</p>}

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
              <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
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
    </>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-secondary px-3 py-2.5 min-w-0">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{icon}{label}</p>
      <p className="font-display text-[19px] font-semibold mt-0.5">{value}</p>
    </div>
  )
}
