"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { X, Plus, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { createClient } from "@/lib/supabase"

export type PlantCategory = "vegetable"|"fruit"|"herb"|"spice"|"nut"|"seed"|"legume"|"grain"|"other"

export interface Plant {
  id: string
  name: string
  emoji: string | null
  category: PlantCategory
  times_eaten: number
  first_eaten_date: string | null
}

const ALL_CATEGORIES: PlantCategory[] = ["vegetable","fruit","herb","spice","nut","seed","legume","grain","other"]

interface PlantPickerProps {
  selected: Plant[]
  onAdd: (plant: Plant) => void
  onRemove: (plantId: string) => void
  label?: string
}

export function PlantPicker({ selected, onAdd, onRemove, label = "Plants in this meal" }: PlantPickerProps) {
  const [query, setQuery] = useState("")
  const [allPlants, setAllPlants] = useState<Plant[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [newPlantOpen, setNewPlantOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newEmoji, setNewEmoji] = useState("")
  const [newCategory, setNewCategory] = useState<PlantCategory>("vegetable")
  const [saving, setSaving] = useState(false)
  const supabase = useRef(createClient()).current

  const selectedIds = new Set(selected.map((p) => p.id))

  const fetchPlants = useCallback(async () => {
    const { data } = await supabase
      .from("plants")
      .select("id, name, emoji, category, times_eaten, first_eaten_date")
      .order("name")
    setAllPlants((data ?? []) as Plant[])
  }, [supabase])

  useEffect(() => { fetchPlants() }, [fetchPlants])

  const filtered = allPlants.filter(
    (p) => !selectedIds.has(p.id) && p.name.toLowerCase().includes(query.toLowerCase()),
  )
  const exactMatch = allPlants.some((p) => p.name.toLowerCase() === query.toLowerCase().trim())

  async function handleAddNew() {
    if (!newName.trim()) return
    setSaving(true)
    const { data, error } = await supabase
      .from("plants")
      .insert({ name: newName.trim(), emoji: newEmoji.trim() || null, category: newCategory })
      .select("id, name, emoji, category, times_eaten, first_eaten_date")
      .single()
    setSaving(false)
    if (!error && data) {
      const plant = data as Plant
      setAllPlants((prev) => [...prev, plant].sort((a, b) => a.name.localeCompare(b.name)))
      onAdd(plant)
      setNewPlantOpen(false)
      setNewName(""); setNewEmoji(""); setNewCategory("vegetable")
      setQuery(""); setShowDropdown(false)
    }
  }

  return (
    <div className="space-y-2">
      {label && <Label className="text-sm text-muted-foreground">{label}</Label>}

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-xs font-medium px-2.5 py-1"
            >
              {p.emoji && <span className="leading-none">{p.emoji}</span>}
              {p.name}
              <button
                type="button"
                onClick={() => onRemove(p.id)}
                className="ml-0.5 hover:text-destructive transition-colors"
                aria-label={`Remove ${p.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setShowDropdown(true) }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          placeholder="Search plants…"
          className="h-8 text-sm"
        />
        {showDropdown && query.length > 0 && (
          <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-md overflow-hidden">
            <div className="max-h-52 overflow-y-auto">
              {filtered.slice(0, 8).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={() => { onAdd(p); setQuery(""); setShowDropdown(false) }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent text-left"
                >
                  <span className="text-base leading-none">{p.emoji ?? "🌿"}</span>
                  <span className="flex-1">{p.name}</span>
                  <span className="text-xs text-muted-foreground capitalize">{p.category}</span>
                </button>
              ))}
              {!exactMatch && query.trim() && (
                <button
                  type="button"
                  onMouseDown={() => { setNewName(query.trim()); setNewPlantOpen(true); setShowDropdown(false) }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent text-left text-primary border-t"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add &ldquo;{query.trim()}&rdquo; as new plant
                </button>
              )}
              {filtered.length === 0 && !(!exactMatch && query.trim()) && (
                <p className="px-3 py-2 text-sm text-muted-foreground italic">No results</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* New plant dialog */}
      <Dialog open={newPlantOpen} onOpenChange={setNewPlantOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Add new plant</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="np-name">Name *</Label>
              <Input id="np-name" value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Dragon Fruit" autoFocus />
            </div>
            <div className="flex gap-3">
              <div className="space-y-1.5 w-20">
                <Label htmlFor="np-emoji">Emoji</Label>
                <Input id="np-emoji" value={newEmoji} onChange={(e) => setNewEmoji(e.target.value)}
                  placeholder="🌿" className="text-center" />
              </div>
              <div className="space-y-1.5 flex-1">
                <Label>Category</Label>
                <Select value={newCategory} onValueChange={(v) => setNewCategory(v as PlantCategory)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALL_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setNewPlantOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleAddNew} disabled={saving || !newName.trim()}>
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Add plant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
