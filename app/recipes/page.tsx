"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Plus, Search, ExternalLink, Pencil, Trash2 } from "lucide-react"
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
    <div className="flex flex-col p-3 lg:p-5 gap-4 max-w-3xl mx-auto w-full pb-24">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold flex-1">Recipe Book</h1>
        <Button size="sm" onClick={openAdd} className="gap-1.5 shrink-0">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Add recipe</span>
          <span className="sm:hidden">Add</span>
        </Button>
      </div>

      {/* ── Search ──────────────────────────────────────────────────────── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search recipes…"
          className="pl-9"
        />
      </div>

      {/* ── Tag filters ─────────────────────────────────────────────────── */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map(tag => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={cn(
                "rounded-full px-3 py-1 text-sm font-medium border transition-colors",
                activeTags.includes(tag)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              {tag}
            </button>
          ))}
          {activeTags.length > 0 && (
            <button
              onClick={() => setActiveTags([])}
              className="rounded-full px-3 py-1 text-sm font-medium border border-dashed border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* ── Recipe list ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <span className="text-5xl select-none">🍳</span>
          {recipes.length === 0 ? (
            <>
              <p className="text-base font-medium">No recipes yet</p>
              <p className="text-sm text-center">Tap <strong>Add recipe</strong> to save your first one</p>
            </>
          ) : (
            <p className="text-base font-medium">No recipes match your filters</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
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
          "fixed z-40 flex items-center justify-center w-14 h-14 rounded-full shadow-lg lg:hidden",
          "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all",
          "bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] right-5",
        )}
        aria-label="Add recipe"
      >
        <Plus className="h-6 w-6" />
      </button>
    </div>
  )
}

// ── Recipe card ────────────────────────────────────────────────────────────────

function RecipeCard({ recipe, deleting, onEdit, onDelete }: {
  recipe: Recipe
  deleting: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3 flex gap-3">
      <div className="flex-1 min-w-0 space-y-1.5">
        {/* Title + URL */}
        <div className="flex items-start gap-2">
          <p className="font-semibold text-base leading-snug flex-1 min-w-0">{recipe.title}</p>
          {recipe.url && (
            <a
              href={recipe.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="shrink-0 mt-0.5 text-muted-foreground hover:text-primary transition-colors"
              aria-label="Open recipe URL"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>

        {/* Notes preview */}
        {recipe.notes && (
          <p className="text-sm text-muted-foreground line-clamp-2 leading-snug">
            {recipe.notes}
          </p>
        )}

        {/* Tags */}
        {recipe.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {recipe.tags.map(tag => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1 shrink-0 justify-start pt-0.5">
        <button
          onClick={onEdit}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Edit recipe"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
          aria-label="Delete recipe"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
