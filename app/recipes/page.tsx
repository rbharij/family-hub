"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Plus, Search, ExternalLink, Pencil, Trash2, BookOpen, Soup } from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase"
import { useRealtimeChannel } from "@/lib/use-realtime"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { PRESET_TAGS, RECIPE_TABLES, type Recipe } from "./_utils"
import { RecipeSheet } from "./_recipe-sheet"

export default function RecipesPage() {
  const [recipes, setRecipes]       = useState<Recipe[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState("")
  const [activeTags, setActiveTags] = useState<string[]>([])

  // Sheet state
  const [sheetOpen, setSheetOpen]     = useState(false)
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null)

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const supabase = useRef(createClient()).current

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchRecipes = useCallback(async () => {
    const { data, error } = await supabase
      .from("recipes")
      .select("id, title, url, notes, tags, created_at")
      .order("title")
    if (!error) setRecipes((data ?? []) as Recipe[])
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchRecipes() }, [fetchRecipes])

  useRealtimeChannel(supabase, "recipes", RECIPE_TABLES, fetchRecipes)

  // ── Filtering ──────────────────────────────────────────────────────────────

  function toggleTag(tag: string) {
    setActiveTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  const filtered = recipes.filter(r => {
    const matchSearch = !search.trim() ||
      r.title.toLowerCase().includes(search.toLowerCase())
    const matchTags = activeTags.length === 0 ||
      activeTags.every(t => r.tags.includes(t))
    return matchSearch && matchTags
  })

  // All tags that appear across saved recipes (preset + custom), for the filter bar
  const allTags = Array.from(new Set([
    ...PRESET_TAGS.filter(t => recipes.some(r => r.tags.includes(t))),
    ...recipes.flatMap(r => r.tags.filter(t => !PRESET_TAGS.includes(t))),
  ]))

  // ── Actions ────────────────────────────────────────────────────────────────

  function openAdd() { setEditingRecipe(null); setSheetOpen(true) }
  function openEdit(r: Recipe) { setEditingRecipe(r); setSheetOpen(true) }

  async function handleDelete(id: string) {
    setDeletingId(id)
    const { error } = await supabase.from("recipes").delete().eq("id", id)
    setDeletingId(null)
    if (error) { toast.error("Couldn't delete recipe"); return }
    toast.success("Recipe deleted")
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col p-4 lg:px-8 lg:py-7 gap-4 lg:gap-5 w-full pb-28 lg:pb-8">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="font-display text-[26px] lg:text-[34px] font-semibold tracking-tight leading-tight">Recipe book</h1>
          <p className="text-[14px] lg:text-[15px] text-muted-foreground">
            {loading ? "Loading…" : `${recipes.length} family recipe${recipes.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="relative w-full sm:w-72 order-last sm:order-none">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search recipes"
            aria-label="Search recipes"
            className="pl-10 h-11 rounded-xl bg-card text-[15px]"
          />
        </div>
        <Button onClick={openAdd} className="hidden lg:inline-flex h-11 px-4 rounded-xl gap-2">
          <Plus className="size-[18px]" />
          Add recipe
        </Button>
      </div>

      {/* ── Tag filters ─────────────────────────────────────────────────── */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by tag">
          <button
            onClick={() => setActiveTags([])}
            aria-pressed={activeTags.length === 0}
            className={cn(
              "rounded-full px-4 min-h-[38px] text-sm font-semibold border transition-colors",
              activeTags.length === 0 ? "bg-foreground text-background border-foreground" : "bg-card border-border hover:border-primary/50",
            )}
          >
            All
          </button>
          {allTags.map(tag => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              aria-pressed={activeTags.includes(tag)}
              className={cn(
                "rounded-full px-4 min-h-[38px] text-sm font-semibold border transition-colors",
                activeTags.includes(tag)
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card border-border hover:border-primary/50",
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* ── Recipe grid ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-44 rounded-3xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl border-[1.5px] border-dashed border-input flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <BookOpen className="size-9" />
          {recipes.length === 0 ? (
            <>
              <p className="text-base font-semibold">No recipes yet</p>
              <Button variant="outline" className="rounded-xl bg-card" onClick={openAdd}>Add your first recipe</Button>
            </>
          ) : (
            <p className="text-base font-semibold">No recipes match your filters</p>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map(recipe => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              deleting={deletingId === recipe.id}
              onEdit={() => openEdit(recipe)}
              onDelete={() => handleDelete(recipe.id)}
            />
          ))}
        </div>
      )}

      {/* ── Sheet ───────────────────────────────────────────────────────── */}
      <RecipeSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSaved={fetchRecipes}
        recipe={editingRecipe}
      />

      {/* ── FAB (mobile) ────────────────────────────────────────────────── */}
      <button
        onClick={openAdd}
        className={cn(
          "fixed z-30 flex items-center justify-center size-14 rounded-full shadow-lg lg:hidden",
          "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all",
          "bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] right-5",
        )}
        aria-label="Add recipe"
      >
        <Plus className="size-6" />
      </button>
    </div>
  )
}

// ── Tag colours ────────────────────────────────────────────────────────────────

const TAG_TINTS: Record<string, string> = {
  chicken: "#C2702E", fish: "#2F5E9E", salad: "#3D6B57", dessert: "#A3456B",
  quick: "#2F7A8C", baking: "#9A7322", korean: "#6A4FA3", snacks: "#9A7322",
  "slow cooker": "#B85F1A", vegetarian: "#3D8B5F", pasta: "#B5492F",
}

function tagTint(tags: string[]): string {
  for (const t of tags) {
    const c = TAG_TINTS[t.toLowerCase()]
    if (c) return c
  }
  return "#8C8279"
}

// ── Recipe card ────────────────────────────────────────────────────────────────

function RecipeCard({ recipe, deleting, onEdit, onDelete }: {
  recipe: Recipe
  deleting: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const tint = tagTint(recipe.tags)
  return (
    <div className="group rounded-3xl border border-border bg-card overflow-hidden flex flex-col">
      <div
        className="h-16 flex items-center justify-between px-5"
        style={{ backgroundColor: `${tint}26` }}
      >
        <Soup className="size-7" style={{ color: tint }} />
        {recipe.url && (
          <a
            href={recipe.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-full bg-card/80 px-2.5 py-1 text-[12px] font-semibold hover:bg-card transition-colors"
            aria-label="Open the original recipe"
          >
            <ExternalLink className="size-3.5" /> Original
          </a>
        )}
      </div>

      <div className="flex-1 flex flex-col gap-2 px-5 pt-3.5 pb-4">
        <button type="button" onClick={onEdit} className="text-left">
          <p className="font-semibold text-[17px] leading-snug">{recipe.title}</p>
        </button>
        {recipe.notes && (
          <p className="text-sm text-muted-foreground line-clamp-2 leading-snug">{recipe.notes}</p>
        )}
        <div className="mt-auto flex items-end gap-2 pt-1">
          <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
            {recipe.tags.map(tag => (
              <span key={tag} className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-[12px] font-semibold text-foreground/75">
                {tag}
              </span>
            ))}
          </div>
          <div className="flex gap-1 shrink-0">
            <button
              onClick={onEdit}
              className="size-9 inline-flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              aria-label="Edit recipe"
            >
              <Pencil className="size-4" />
            </button>
            <button
              onClick={onDelete}
              disabled={deleting}
              className="size-9 inline-flex items-center justify-center rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
              aria-label="Delete recipe"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
