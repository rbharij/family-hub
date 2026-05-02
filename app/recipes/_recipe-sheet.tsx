"use client"

import { useEffect, useRef, useState } from "react"
import { X, Plus, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { PRESET_TAGS, type Recipe } from "./_utils"

interface RecipeSheetProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  recipe: Recipe | null   // null = create mode
}

export function RecipeSheet({ open, onClose, onSaved, recipe }: RecipeSheetProps) {
  const [title, setTitle]     = useState("")
  const [url, setUrl]         = useState("")
  const [notes, setNotes]     = useState("")
  const [tags, setTags]       = useState<string[]>([])
  const [customTag, setCustomTag] = useState("")
  const [saving, setSaving]   = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const supabase = useRef(createClient()).current

  // Reset form when sheet opens/closes
  useEffect(() => {
    if (!open) return
    setTitle(recipe?.title ?? "")
    setUrl(recipe?.url ?? "")
    setNotes(recipe?.notes ?? "")
    setTags(recipe?.tags ?? [])
    setCustomTag("")
    setUrlError(null)
  }, [open, recipe])

  function toggleTag(tag: string) {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  function addCustomTag() {
    const t = customTag.trim()
    if (!t || tags.includes(t)) { setCustomTag(""); return }
    setTags(prev => [...prev, t])
    setCustomTag("")
  }

  function validateUrl(value: string): boolean {
    if (!value.trim()) return true
    try { new URL(value.trim()); return true } catch { return false }
  }

  async function handleSave() {
    if (!title.trim()) return
    const trimmedUrl = url.trim() || null
    if (trimmedUrl && !validateUrl(trimmedUrl)) {
      setUrlError("Please enter a valid URL (include https://)")
      return
    }
    setUrlError(null)
    setSaving(true)
    try {
      const payload = { title: title.trim(), url: trimmedUrl, notes: notes.trim() || null, tags }
      if (recipe) {
        const { error } = await supabase.from("recipes").update(payload).eq("id", recipe.id)
        if (error) throw error
        toast.success("Recipe updated")
      } else {
        const { error } = await supabase.from("recipes").insert(payload)
        if (error) throw error
        toast.success("Recipe saved")
      }
      onSaved()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl px-4 pb-8">
        <SheetHeader className="mb-4">
          <SheetTitle>{recipe ? "Edit recipe" : "Add recipe"}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="recipe-title">Title <span className="text-destructive">*</span></Label>
            <Input
              id="recipe-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Chicken Fried Rice"
              autoFocus
            />
          </div>

          {/* URL */}
          <div className="space-y-1.5">
            <Label htmlFor="recipe-url">URL <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
            <Input
              id="recipe-url"
              value={url}
              onChange={e => { setUrl(e.target.value); setUrlError(null) }}
              placeholder="https://..."
              type="url"
              inputMode="url"
            />
            {urlError && <p className="text-xs text-destructive">{urlError}</p>}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="recipe-notes">Notes <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
            <Textarea
              id="recipe-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Ingredients, tips, substitutions…"
              rows={4}
              className="resize-none"
            />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_TAGS.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    "rounded-full px-3 py-1 text-sm font-medium border transition-colors",
                    tags.includes(tag)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                  )}
                >
                  {tag}
                </button>
              ))}
              {/* Custom tags already added */}
              {tags.filter(t => !PRESET_TAGS.includes(t)).map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium border bg-primary text-primary-foreground border-primary"
                >
                  {tag}
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
            {/* Custom tag input */}
            <div className="flex gap-2">
              <Input
                value={customTag}
                onChange={e => setCustomTag(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustomTag() } }}
                placeholder="Add custom tag…"
                className="h-8 text-sm flex-1"
              />
              <Button type="button" variant="outline" size="sm" onClick={addCustomTag}
                disabled={!customTag.trim()}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <SheetFooter className="mt-6 flex-row gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" onClick={handleSave}
            disabled={saving || !title.trim()}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {recipe ? "Save changes" : "Add recipe"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
