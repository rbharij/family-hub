"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Minus, Plus, Snowflake, Trash2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase"
import { useRealtimeChannel } from "@/lib/use-realtime"
import { daysBetween, FREEZER_OLD_DAYS, type FreezerItem } from "@/lib/meal-planner"
import { toDateStr } from "../_utils"

const FREEZER_TABLES = [{ table: "freezer_items" }] as const

export function FreezerView() {
  const supabase = useRef(createClient()).current
  const [items, setItems]     = useState<FreezerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [dish, setDish]       = useState("")
  const [portions, setPortions] = useState(4)
  const [frozenOn, setFrozenOn] = useState(() => toDateStr(new Date()))
  const [adding, setAdding]   = useState(false)

  const fetchItems = useCallback(async () => {
    const { data } = await supabase.from("freezer_items").select("*").gt("portions", 0).order("frozen_on")
    setItems((data ?? []) as FreezerItem[])
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchItems() }, [fetchItems])
  useRealtimeChannel(supabase, "freezer", FREEZER_TABLES, fetchItems)

  async function add() {
    if (!dish.trim() || portions < 1) return
    setAdding(true)
    const { error } = await supabase.from("freezer_items").insert({ dish: dish.trim(), portions, frozen_on: frozenOn })
    setAdding(false)
    if (error) { toast.error("Couldn't add to the freezer"); return }
    setDish(""); setPortions(4); setFrozenOn(toDateStr(new Date()))
    fetchItems()
  }

  async function changePortions(item: FreezerItem, delta: number) {
    const next = Math.max(0, item.portions + delta)
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, portions: next } : i)).filter((i) => i.portions > 0))
    const { error } = await supabase.from("freezer_items").update({ portions: next }).eq("id", item.id)
    if (error) { toast.error("Couldn't update"); fetchItems() }
  }

  async function remove(item: FreezerItem) {
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    const { error } = await supabase.from("freezer_items").update({ portions: 0 }).eq("id", item.id)
    if (error) { toast.error("Couldn't remove"); fetchItems() }
  }

  const today = toDateStr(new Date())
  const totalPortions = items.reduce((s, i) => s + i.portions, 0)

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px] items-start">
      <div className="rounded-[24px] bg-card border border-border p-5 flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-[22px] font-semibold">In the freezer</h2>
          <p className="text-[14px] font-semibold text-muted-foreground tabular-nums">
            {items.length} dish{items.length === 1 ? "" : "es"} · {totalPortions} portions
          </p>
        </div>

        {loading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
            <Snowflake className="size-8" />
            <p>The freezer is empty. Batch cooks from the planner land here.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => {
              const age = daysBetween(item.frozen_on, today)
              const old = age >= FREEZER_OLD_DAYS
              return (
                <li key={item.id} className={cn(
                  "flex items-center gap-3 rounded-2xl border px-4 py-3",
                  old ? "border-destructive/40 bg-destructive/5" : "border-border bg-background/70",
                )}>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[16px] truncate">{item.dish}</p>
                    <p className="text-[13px] text-muted-foreground flex items-center gap-1.5">
                      {old && <AlertTriangle className="size-3.5 text-destructive" />}
                      Frozen {new Date(item.frozen_on + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      {" · "}{age <= 0 ? "today" : `${age} day${age === 1 ? "" : "s"} ago`}
                      {old && " · use soon"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon-sm" className="rounded-lg" onClick={() => changePortions(item, -1)} aria-label="One fewer portion">
                      <Minus />
                    </Button>
                    <span className="w-8 text-center font-semibold tabular-nums">{item.portions}</span>
                    <Button variant="outline" size="icon-sm" className="rounded-lg" onClick={() => changePortions(item, 1)} aria-label="One more portion">
                      <Plus />
                    </Button>
                  </div>
                  <Button variant="ghost" size="icon-sm" className="rounded-lg text-muted-foreground" onClick={() => remove(item)} aria-label="Remove">
                    <Trash2 />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="rounded-[24px] bg-card border border-border p-5 flex flex-col gap-3">
        <h2 className="font-display text-[20px] font-semibold">Add to freezer</h2>
        <div className="space-y-1.5">
          <Label htmlFor="frz-dish">Dish</Label>
          <Input id="frz-dish" value={dish} onChange={(e) => setDish(e.target.value)} placeholder="e.g. Chicken curry" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="frz-portions">Portions</Label>
            <Input id="frz-portions" type="number" min={1} value={portions} onChange={(e) => setPortions(Math.max(1, Number(e.target.value) || 1))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="frz-date">Frozen on</Label>
            <Input id="frz-date" type="date" value={frozenOn} onChange={(e) => setFrozenOn(e.target.value)} />
          </div>
        </div>
        <Button className="h-11 rounded-xl" onClick={add} disabled={adding || !dish.trim()}>
          {adding ? "Adding…" : "Add"}
        </Button>
        <p className="text-[12.5px] text-muted-foreground">
          Portions come off automatically when a confirmed plan uses them. Items older than {FREEZER_OLD_DAYS} days are flagged and the planner uses them first.
        </p>
      </div>
    </div>
  )
}
