"use client"

import {
  useCallback, useEffect, useRef, useState,
  KeyboardEvent, PointerEvent as ReactPointerEvent,
} from "react"
import { Trash2, Plus, Loader2, MoreHorizontal, Check, ShoppingCart } from "lucide-react"
import { toast } from "sonner"
import { useRealtimeChannel } from "@/lib/use-realtime"
import { ErrorBoundary } from "@/components/error-boundary"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase"
import { Skeleton } from "@/components/ui/skeleton"

// ── Types ──────────────────────────────────────────────────────────────────────

interface ShoppingList { id: string; name: string }

interface ShoppingItem {
  id: string; list_id: string; name: string
  quantity: number; completed: boolean; created_at: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const UNDO_DELAY = 3000

// ── Stable realtime config ─────────────────────────────────────────────────────
const SHOPPING_TABLES = [{ table: "shopping_items" }] as const

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ShoppingPage() {
  const [lists, setLists]         = useState<ShoppingList[]>([])
  const [items, setItems]         = useState<ShoppingItem[]>([])
  const [activeTab, setActiveTab] = useState<string>("")
  const [loading, setLoading]     = useState(true)

  const supabase = useRef(createClient()).current

  useEffect(() => {
    supabase.from("shopping_lists").select("id, name").order("created_at")
      .then(({ data }) => {
        const loaded = (data ?? []) as ShoppingList[]
        setLists(loaded)
        if (loaded.length > 0) setActiveTab((prev) => prev || loaded[0].name)
      })
  }, [supabase])

  const fetchItems = useCallback(async () => {
    const { data } = await supabase
      .from("shopping_items")
      .select("id, list_id, name, quantity, completed, created_at")
      .order("created_at")
    setItems(data ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchItems() }, [fetchItems])

  // ── Realtime ──────────────────────────────────────────────────────────────
  useRealtimeChannel(supabase, "shopping-items-all", SHOPPING_TABLES, fetchItems)

  // ── Optimistic add ────────────────────────────────────────────────────────
  async function addItem(listId: string, name: string, quantity: number) {
    const tempId = `temp-${Date.now()}`
    const optimistic: ShoppingItem = {
      id: tempId,
      list_id: listId,
      name,
      quantity,
      completed: false,
      created_at: new Date().toISOString(),
    }
    setItems((prev) => [...prev, optimistic])

    const { data, error } = await supabase
      .from("shopping_items")
      .insert({ list_id: listId, name, quantity, completed: false })
      .select("id, list_id, name, quantity, completed, created_at")
      .single()

    if (error || !data) {
      setItems((prev) => prev.filter((i) => i.id !== tempId))
      toast.error("Couldn't add item. Please try again.")
    } else {
      setItems((prev) => prev.map((i) => i.id === tempId ? data as ShoppingItem : i))
    }
  }

  // ── Optimistic toggle ────────────────────────────────────────────────────
  async function toggleItem(item: ShoppingItem) {
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, completed: !i.completed } : i))
    const { error } = await supabase
      .from("shopping_items")
      .update({ completed: !item.completed })
      .eq("id", item.id)
    if (error) {
      setItems((prev) => prev.map((i) => i.id === item.id ? item : i))
      toast.error("Couldn't update item. Please try again.")
    }
  }

  // ── Optimistic delete ────────────────────────────────────────────────────
  function deleteItem(item: ShoppingItem) {
    setItems((prev) => prev.filter((i) => i.id !== item.id))

    const tid = setTimeout(async () => {
      await supabase.from("shopping_items").delete().eq("id", item.id)
    }, UNDO_DELAY)

    toast(`Removed "${item.name}"`, {
      duration: UNDO_DELAY,
      action: {
        label: "Undo",
        onClick: () => {
          clearTimeout(tid)
          setItems((prev) => {
            const exists = prev.some((i) => i.id === item.id)
            return exists ? prev : [...prev, item].sort(
              (a, b) => a.created_at.localeCompare(b.created_at),
            )
          })
        },
      },
    })
  }

  // ── Optimistic update ─────────────────────────────────────────────────────
  async function updateItem(item: ShoppingItem, name: string, quantity: number) {
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, name, quantity } : i))
    const { error } = await supabase
      .from("shopping_items")
      .update({ name, quantity })
      .eq("id", item.id)
    if (error) {
      setItems((prev) => prev.map((i) => i.id === item.id ? item : i))
      toast.error("Couldn't update item.")
    }
  }

  // ── Rename list ───────────────────────────────────────────────────────────
  async function renameList(listId: string, oldName: string, newName: string) {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === oldName) return
    // Optimistic update
    setLists((prev) => prev.map((l) => l.id === listId ? { ...l, name: trimmed } : l))
    if (activeTab === oldName) setActiveTab(trimmed)
    const { error } = await supabase
      .from("shopping_lists")
      .update({ name: trimmed })
      .eq("id", listId)
    if (error) {
      // Revert
      setLists((prev) => prev.map((l) => l.id === listId ? { ...l, name: oldName } : l))
      if (activeTab === trimmed) setActiveTab(oldName)
      toast.error("Couldn't rename list.")
    }
  }

  // ── Clear helpers ─────────────────────────────────────────────────────────
  async function clearCompleted(listId: string) {
    const toRemove = items.filter((i) => i.list_id === listId && i.completed)
    setItems((prev) => prev.filter((i) => !(i.list_id === listId && i.completed)))
    const ids = toRemove.map((i) => i.id)
    if (ids.length) {
      await supabase.from("shopping_items").delete().in("id", ids)
      toast(`Cleared ${ids.length} completed item${ids.length !== 1 ? "s" : ""}`)
    }
  }

  async function clearAll(listId: string, listName: string) {
    const toRemove = items.filter((i) => i.list_id === listId)
    setItems((prev) => prev.filter((i) => i.list_id !== listId))
    const ids = toRemove.map((i) => i.id)
    if (ids.length) {
      await supabase.from("shopping_items").delete().in("id", ids)
      toast(`Cleared all ${ids.length} item${ids.length !== 1 ? "s" : ""} from ${listName}`)
    }
  }

  function itemsForList(listId: string) { return items.filter((i) => i.list_id === listId) }
  function uncheckedCount(listId: string) {
    return itemsForList(listId).filter((i) => !i.completed).length
  }

  // Don't render tabs until lists have loaded — Radix Tabs throws if value=""
  // doesn't match any TabsTrigger child.
  if (lists.length === 0) {
    return (
      <div className="flex flex-col lg:h-full p-3 lg:p-4 gap-3">
        <div className="flex gap-4 border-b pb-2">
          {[1,2,3,4].map((i) => <Skeleton key={i} className="h-8 w-20 rounded" />)}
        </div>
        <div className="space-y-2 px-1">
          {[1,2,3,4,5].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col lg:h-full p-3 lg:p-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}
        className="flex flex-col flex-1 min-h-0 gap-0">

        {/* Tab bar */}
        <TabsList variant="line"
          className="w-full justify-start border-b rounded-none px-0 h-auto pb-0 shrink-0 gap-0">
          {lists.map((list) => {
            const count = uncheckedCount(list.id)
            return (
              <TabsTrigger key={list.id} value={list.name}
                className="rounded-none px-4 py-2.5 text-sm border-b-2 -mb-px gap-2">
                {list.name}
                {count > 0 && (
                  <span className={cn(
                    "inline-flex items-center justify-center rounded-full text-[11px] font-bold",
                    "min-w-[20px] h-5 px-1.5",
                    activeTab === list.name
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}>{count}</span>
                )}
              </TabsTrigger>
            )
          })}
        </TabsList>

        {/* Panels */}
        {lists.map((list) => (
          <TabsContent key={list.id} value={list.name}
            className="flex-1 min-h-0 overflow-hidden flex flex-col mt-0">
            <ErrorBoundary label={`${list.name} list`}>
              <ListPanel
                list={list}
                items={itemsForList(list.id)}
                loading={loading}
                onAdd={(n, q) => addItem(list.id, n, q)}
                onToggle={toggleItem}
                onDelete={(item) => deleteItem(item)}
                onUpdate={updateItem}
                onClearCompleted={() => clearCompleted(list.id)}
                onClearAll={() => clearAll(list.id, list.name)}
                onRename={(newName) => renameList(list.id, list.name, newName)}
              />
            </ErrorBoundary>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

// ── List panel ─────────────────────────────────────────────────────────────────

interface ListPanelProps {
  list: ShoppingList
  items: ShoppingItem[]
  loading: boolean
  onAdd: (name: string, quantity: number) => void
  onToggle: (item: ShoppingItem) => void
  onDelete: (item: ShoppingItem) => void
  onUpdate: (item: ShoppingItem, name: string, qty: number) => void
  onClearCompleted: () => void
  onClearAll: () => void
  onRename: (newName: string) => void
}

function ListPanel({
  list, items, loading,
  onAdd, onToggle, onDelete, onUpdate, onClearCompleted, onClearAll, onRename,
}: ListPanelProps) {
  const [draft, setDraft]           = useState("")
  const [draftQty, setDraftQty]     = useState(1)
  const [adding, setAdding]         = useState(false)
  const [clearAllOpen, setClearAllOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const inputRef  = useRef<HTMLInputElement>(null)
  const renameRef = useRef<HTMLInputElement>(null)

  const unchecked = items.filter((i) => !i.completed)
  const checked   = items.filter((i) => i.completed)

  async function handleAdd() {
    const name = draft.trim()
    if (!name) return
    setAdding(true)
    setDraft("")
    setDraftQty(1)
    await onAdd(name, draftQty)
    setAdding(false)
    inputRef.current?.focus()
  }

  function openRename() {
    setRenameValue(list.name)
    setRenameOpen(true)
  }

  function commitRename() {
    onRename(renameValue)
    setRenameOpen(false)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto">
        {/* List header */}
        <div className="flex items-center justify-between px-4 pt-2 pb-1">
          <span className="text-xs text-muted-foreground">
            {unchecked.length} remaining · {checked.length} done
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent transition-colors"
              aria-label="List options"
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={openRename}>
                Rename list
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={checked.length === 0}
                onSelect={onClearCompleted}
              >
                Clear completed ({checked.length})
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={items.length === 0}
                onSelect={() => setClearAllOpen(true)}
                className="text-destructive focus:text-destructive"
              >
                Clear all ({items.length})
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {loading ? (
          <div className="px-4 py-4 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <ShoppingCart className="h-10 w-10 opacity-30" />
            <p className="text-base font-medium">List is empty</p>
            <p className="text-sm">Add items using the input below.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {unchecked.map((item) => (
              <ItemRow key={item.id} item={item}
                onToggle={onToggle} onDelete={onDelete} onUpdate={onUpdate} />
            ))}

            {unchecked.length > 0 && checked.length > 0 && (
              <li className="px-4 py-1.5 bg-muted/30">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Done ({checked.length})
                </span>
              </li>
            )}

            {checked.map((item) => (
              <ItemRow key={item.id} item={item}
                onToggle={onToggle} onDelete={onDelete} onUpdate={onUpdate} />
            ))}
          </ul>
        )}
      </div>

      {/* ── Add item bar ─────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom,0px)]">
        {checked.length > 0 && (
          <div className="px-3 pt-2">
            <Button variant="outline" size="sm"
              className="w-full text-muted-foreground h-11 gap-1.5 text-sm"
              onClick={onClearCompleted}>
              <Check className="h-4 w-4" />
              Clear {checked.length} completed item{checked.length !== 1 ? "s" : ""}
            </Button>
          </div>
        )}

        <div className="px-3 py-3 space-y-2 max-w-2xl">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && handleAdd()}
              placeholder={`Add to ${list.name}…`}
              className="flex-1 h-11 text-base"
            />
            <Button
              onClick={handleAdd}
              disabled={!draft.trim() || adding}
              className="h-11 px-4 shrink-0 gap-1.5"
            >
              {adding
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Plus className="h-4 w-4" />}
              <span className="hidden sm:inline">Add</span>
            </Button>
          </div>

          {/* Quantity — only shown when there's a draft name */}
          {draft.trim() && (
            <div className="flex items-center gap-2 animate-in fade-in duration-150">
              <Label htmlFor="draft-qty" className="text-xs text-muted-foreground shrink-0">
                Quantity
              </Label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setDraftQty((q) => Math.max(1, q - 1))}
                  className="h-7 w-7 rounded-md border text-sm font-bold hover:bg-muted transition-colors flex items-center justify-center"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span className="w-8 text-center text-sm font-semibold tabular-nums">
                  {draftQty}
                </span>
                <button
                  type="button"
                  onClick={() => setDraftQty((q) => q + 1)}
                  className="h-7 w-7 rounded-md border text-sm font-bold hover:bg-muted transition-colors flex items-center justify-center"
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename list</DialogTitle>
          </DialogHeader>
          <Input
            ref={renameRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename()
              if (e.key === "Escape") setRenameOpen(false)
            }}
            autoFocus
            className="h-10"
          />
          <DialogFooter className="gap-2">
            <DialogClose>Cancel</DialogClose>
            <Button
              size="sm"
              onClick={commitRename}
              disabled={!renameValue.trim() || renameValue.trim() === list.name}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear all confirmation */}
      <Dialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Clear all items?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently remove all {items.length} item{items.length !== 1 ? "s" : ""} from{" "}
            <strong>{list.name}</strong>. This cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <DialogClose>Cancel</DialogClose>
            <Button variant="destructive" size="sm" onClick={() => { onClearAll(); setClearAllOpen(false) }}>
              Clear all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Item row ───────────────────────────────────────────────────────────────────

const LONG_PRESS_DELAY = 500

function ItemRow({
  item, onToggle, onDelete, onUpdate,
}: {
  item: ShoppingItem
  onToggle: (i: ShoppingItem) => void
  onDelete: (i: ShoppingItem) => void
  onUpdate: (i: ShoppingItem, name: string, qty: number) => void
}) {
  const [editing, setEditing]   = useState(false)
  const [editName, setEditName] = useState(item.name)
  const [editQty, setEditQty]   = useState(item.quantity)
  const longPressTimer           = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didLongPress             = useRef(false)
  const editRef                  = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) { setEditName(item.name); setEditQty(item.quantity) }
  }, [item.name, item.quantity, editing])

  useEffect(() => {
    if (editing) editRef.current?.focus()
  }, [editing])

  function onPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0) return
    didLongPress.current = false
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true
      setEditing(true)
    }, LONG_PRESS_DELAY)
  }

  function onPointerUp() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
  }

  function onPointerCancel() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
  }

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    setEditing(true)
  }

  function commitEdit() {
    const name = editName.trim()
    const qty  = Math.max(1, editQty)
    if (name && (name !== item.name || qty !== item.quantity)) {
      onUpdate(item, name, qty)
    }
    setEditing(false)
  }

  function onEditKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter")  commitEdit()
    if (e.key === "Escape") { setEditing(false); setEditName(item.name); setEditQty(item.quantity) }
  }

  if (editing) {
    return (
      <li className="flex items-center gap-2 px-4 py-2 min-h-[52px] bg-accent/30">
        <Input
          ref={editRef}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={onEditKeyDown}
          onBlur={commitEdit}
          className="flex-1 h-9 text-base"
          aria-label="Edit item name"
        />
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setEditQty((q) => Math.max(1, q - 1))}
            className="h-8 w-8 rounded-md border text-sm font-bold hover:bg-muted transition-colors flex items-center justify-center"
          >−</button>
          <span className="w-7 text-center text-sm font-semibold tabular-nums">{editQty}</span>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setEditQty((q) => q + 1)}
            className="h-8 w-8 rounded-md border text-sm font-bold hover:bg-muted transition-colors flex items-center justify-center"
          >+</button>
        </div>
        <Button size="sm" className="h-9 shrink-0" onMouseDown={(e) => e.preventDefault()} onClick={commitEdit}>
          Save
        </Button>
      </li>
    )
  }

  return (
    <li
      className={cn(
        "group flex items-center gap-3 px-4 transition-colors select-none",
        "min-h-[52px]",
        item.completed ? "bg-muted/20 hover:bg-muted/30" : "hover:bg-muted/10",
      )}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={onContextMenu}
    >
      <Checkbox
        checked={item.completed}
        onCheckedChange={() => {
          if (!didLongPress.current) onToggle(item)
          didLongPress.current = false
        }}
        className={cn(
          "h-5 w-5 shrink-0 rounded-full border-2 transition-all",
          item.completed && "opacity-50",
        )}
        aria-label={`Mark ${item.name} ${item.completed ? "incomplete" : "complete"}`}
      />

      <span
        className={cn(
          "flex-1 text-base lg:text-lg font-medium cursor-pointer",
          item.completed && "line-through text-muted-foreground",
        )}
        onClick={() => {
          if (!didLongPress.current) onToggle(item)
          didLongPress.current = false
        }}
      >
        {item.name}
      </span>

      {item.quantity > 1 && (
        <span className={cn(
          "shrink-0 text-sm font-semibold tabular-nums px-2 py-0.5 rounded-full",
          item.completed ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
        )}>
          ×{item.quantity}
        </span>
      )}

      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onDelete(item) }}
        className={cn(
          "shrink-0 p-1.5 rounded-md text-muted-foreground transition-opacity",
          "opacity-100 lg:opacity-0 lg:group-hover:opacity-100",
          "hover:text-destructive hover:bg-destructive/10",
        )}
        aria-label={`Remove ${item.name}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  )
}
