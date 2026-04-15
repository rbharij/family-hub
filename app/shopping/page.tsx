"use client"

import {
  useCallback, useEffect, useRef, useState,
  KeyboardEvent, PointerEvent as ReactPointerEvent,
} from "react"
import {
  Trash2, Plus, Loader2, MoreHorizontal, Check, ShoppingCart, Pencil, X,
} from "lucide-react"
import { toast } from "sonner"
import { useRealtimeChannel } from "@/lib/use-realtime"
import { ErrorBoundary } from "@/components/error-boundary"
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

interface ShoppingList { id: string; name: string; display_order: number }
interface ShoppingItem {
  id: string; list_id: string; name: string
  quantity: number; completed: boolean; created_at: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const UNDO_DELAY  = 3000
const MAX_LISTS   = 8
const LONG_PRESS  = 400
const ITEMS_TABLE = [{ table: "shopping_items" }] as const
const LISTS_TABLE = [{ table: "shopping_lists" }] as const

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ShoppingPage() {
  const [lists, setLists]         = useState<ShoppingList[]>([])
  const [items, setItems]         = useState<ShoppingItem[]>([])
  const [activeTab, setActiveTab] = useState<string>("")
  const [loading, setLoading]     = useState(true)

  // Inline rename on tab
  const [editingId, setEditingId]     = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")

  // Delete confirmation
  const [pendingDelete, setPendingDelete] = useState<ShoppingList | null>(null)

  // Create list
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState("")
  const [creating, setCreating]     = useState(false)

  // Drag-and-drop visual state
  const [dragId,     setDragId]     = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  // Per-tab ⋯ dropdown open tracking (needed for focus-conflict fix)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  // Pointer drag (mobile long-press)
  const ptrDrag = useRef<{
    listId: string | null; pointerId: number | null
    timer: ReturnType<typeof setTimeout> | null; active: boolean
  }>({ listId: null, pointerId: null, timer: null, active: false })

  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const supabase = useRef(createClient()).current

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchLists = useCallback(async () => {
    const { data } = await supabase
      .from("shopping_lists")
      .select("id, name, display_order")
      .order("display_order", { ascending: true, nullsFirst: true })
    const loaded = (data ?? []) as ShoppingList[]
    setLists(loaded)
    setActiveTab(prev =>
      prev && loaded.some(l => l.id === prev) ? prev : (loaded[0]?.id ?? ""),
    )
  }, [supabase])

  const fetchItems = useCallback(async () => {
    const { data } = await supabase
      .from("shopping_items")
      .select("id, list_id, name, quantity, completed, created_at")
      .order("created_at")
    setItems(data ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchLists() }, [fetchLists])
  useEffect(() => { fetchItems() }, [fetchItems])

  useRealtimeChannel(supabase, "shopping-lists-rt", LISTS_TABLE, fetchLists)
  useRealtimeChannel(supabase, "shopping-items-rt", ITEMS_TABLE, fetchItems)

  // ── Helpers ───────────────────────────────────────────────────────────────

  function itemsForList(listId: string) { return items.filter(i => i.list_id === listId) }
  function uncheckedCount(listId: string) { return itemsForList(listId).filter(i => !i.completed).length }

  // ── Items ─────────────────────────────────────────────────────────────────

  async function addItem(listId: string, name: string, quantity: number) {
    const tempId = `temp-${Date.now()}`
    const optimistic: ShoppingItem = {
      id: tempId, list_id: listId, name, quantity,
      completed: false, created_at: new Date().toISOString(),
    }
    setItems(prev => [...prev, optimistic])
    const { data, error } = await supabase
      .from("shopping_items")
      .insert({ list_id: listId, name, quantity, completed: false })
      .select("id, list_id, name, quantity, completed, created_at")
      .single()
    if (error || !data) {
      setItems(prev => prev.filter(i => i.id !== tempId))
      toast.error("Couldn't add item.")
    } else {
      setItems(prev => prev.map(i => i.id === tempId ? data as ShoppingItem : i))
    }
  }

  async function toggleItem(item: ShoppingItem) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, completed: !i.completed } : i))
    const { error } = await supabase
      .from("shopping_items").update({ completed: !item.completed }).eq("id", item.id)
    if (error) {
      setItems(prev => prev.map(i => i.id === item.id ? item : i))
      toast.error("Couldn't update item.")
    }
  }

  function deleteItem(item: ShoppingItem) {
    setItems(prev => prev.filter(i => i.id !== item.id))
    const tid = setTimeout(async () => {
      await supabase.from("shopping_items").delete().eq("id", item.id)
    }, UNDO_DELAY)
    toast(`Removed "${item.name}"`, {
      duration: UNDO_DELAY,
      action: {
        label: "Undo",
        onClick: () => {
          clearTimeout(tid)
          setItems(prev => {
            const exists = prev.some(i => i.id === item.id)
            return exists ? prev : [...prev, item].sort(
              (a, b) => a.created_at.localeCompare(b.created_at),
            )
          })
        },
      },
    })
  }

  async function updateItem(item: ShoppingItem, name: string, quantity: number) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, name, quantity } : i))
    const { error } = await supabase
      .from("shopping_items").update({ name, quantity }).eq("id", item.id)
    if (error) {
      setItems(prev => prev.map(i => i.id === item.id ? item : i))
      toast.error("Couldn't update item.")
    }
  }

  async function clearCompleted(listId: string) {
    const toRemove = items.filter(i => i.list_id === listId && i.completed)
    setItems(prev => prev.filter(i => !(i.list_id === listId && i.completed)))
    const ids = toRemove.map(i => i.id)
    if (ids.length) {
      await supabase.from("shopping_items").delete().in("id", ids)
      toast(`Cleared ${ids.length} completed item${ids.length !== 1 ? "s" : ""}`)
    }
  }

  async function clearAll(listId: string, listName: string) {
    const toRemove = items.filter(i => i.list_id === listId)
    setItems(prev => prev.filter(i => i.list_id !== listId))
    const ids = toRemove.map(i => i.id)
    if (ids.length) {
      await supabase.from("shopping_items").delete().in("id", ids)
      toast(`Cleared all items from ${listName}`)
    }
  }

  // ── Lists: create ─────────────────────────────────────────────────────────

  async function handleCreateList() {
    const name = createName.trim()
    if (!name || lists.length >= MAX_LISTS) return
    setCreating(true)
    const maxOrder = lists.length > 0
      ? Math.max(...lists.map(l => l.display_order ?? 0)) : 0
    const { data, error } = await supabase
      .from("shopping_lists")
      .insert({ name, display_order: maxOrder + 1 })
      .select("id, name, display_order")
      .single()
    if (error || !data) {
      toast.error("Couldn't create list.")
    } else {
      const newList = data as ShoppingList
      setLists(prev => [...prev, newList])
      setActiveTab(newList.id)
      setCreateName("")
      setCreateOpen(false)
    }
    setCreating(false)
  }

  // ── Lists: rename ─────────────────────────────────────────────────────────

  function startRename(list: ShoppingList) {
    setEditingId(list.id)
    setEditingName(list.name)
  }

  async function commitRename() {
    if (!editingId) return
    const id       = editingId
    const trimmed  = editingName.trim()
    const original = lists.find(l => l.id === id)?.name ?? ""
    setEditingId(null)
    if (!trimmed || trimmed === original) return
    setLists(prev => prev.map(l => l.id === id ? { ...l, name: trimmed } : l))
    const { error } = await supabase
      .from("shopping_lists").update({ name: trimmed }).eq("id", id)
    if (error) {
      setLists(prev => prev.map(l => l.id === id ? { ...l, name: original } : l))
      toast.error("Couldn't rename list.")
    }
  }

  // ── Lists: delete ─────────────────────────────────────────────────────────

  async function handleDeleteList() {
    if (!pendingDelete) return
    const list = pendingDelete
    setPendingDelete(null)
    const remaining = lists.filter(l => l.id !== list.id)
    if (activeTab === list.id) setActiveTab(remaining[0]?.id ?? "")
    setLists(remaining)
    setItems(prev => prev.filter(i => i.list_id !== list.id))
    await supabase.from("shopping_items").delete().eq("list_id", list.id)
    const { error } = await supabase.from("shopping_lists").delete().eq("id", list.id)
    if (error) { fetchLists(); toast.error("Couldn't delete list.") }
    else toast(`Deleted "${list.name}"`)
  }

  // ── Lists: reorder ────────────────────────────────────────────────────────

  async function reorderLists(fromId: string, toId: string) {
    if (fromId === toId) return
    const fromIdx = lists.findIndex(l => l.id === fromId)
    const toIdx   = lists.findIndex(l => l.id === toId)
    if (fromIdx === -1 || toIdx === -1) return
    const reordered = [...lists]
    const [moved]   = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    const updated = reordered.map((l, i) => ({ ...l, display_order: i + 1 }))
    setLists(updated)
    const results = await Promise.all(
      updated.map(l =>
        supabase.from("shopping_lists")
          .update({ display_order: l.display_order }).eq("id", l.id),
      ),
    )
    if (results.some(r => r.error)) { fetchLists(); toast.error("Couldn't save order.") }
  }

  // ── HTML5 drag (desktop) ──────────────────────────────────────────────────

  function onDragStart(e: React.DragEvent, listId: string) {
    if (ptrDrag.current.timer) { clearTimeout(ptrDrag.current.timer); ptrDrag.current.timer = null }
    ptrDrag.current.active = false
    setDragId(listId)
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", listId)
  }

  function onDragOver(e: React.DragEvent, listId: string) {
    e.preventDefault(); e.dataTransfer.dropEffect = "move"
    setDragOverId(listId)
  }

  function onDrop(e: React.DragEvent, listId: string) {
    e.preventDefault()
    const fromId = e.dataTransfer.getData("text/plain")
    if (fromId && fromId !== listId) reorderLists(fromId, listId)
    setDragId(null); setDragOverId(null)
  }

  function onDragEnd() { setDragId(null); setDragOverId(null) }

  // ── Pointer drag (mobile long-press) ──────────────────────────────────────

  function onTabPointerDown(e: ReactPointerEvent, listId: string) {
    ptrDrag.current.listId    = listId
    ptrDrag.current.pointerId = e.pointerId
    ptrDrag.current.timer = setTimeout(() => {
      ptrDrag.current.active = true
      setDragId(listId)
      try { tabRefs.current[listId]?.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    }, LONG_PRESS)
  }

  function onTabRowPointerMove(e: ReactPointerEvent) {
    if (!ptrDrag.current.active) return
    const els = document.elementsFromPoint(e.clientX, e.clientY)
    for (const el of els) {
      const tabId = (el as HTMLElement).dataset.tabId
      if (tabId) { setDragOverId(tabId); break }
    }
  }

  function onTabRowPointerUp() {
    if (ptrDrag.current.timer) { clearTimeout(ptrDrag.current.timer); ptrDrag.current.timer = null }
    if (ptrDrag.current.active && dragOverId && dragOverId !== ptrDrag.current.listId) {
      reorderLists(ptrDrag.current.listId!, dragOverId)
    }
    ptrDrag.current.active = false; ptrDrag.current.listId = null
    setDragId(null); setDragOverId(null)
  }

  // ── Tab dropdown helper (prevents Radix focus/dialog conflict) ────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function tabMenuSelect(listId: string, action: () => void): (e: any) => void {
    return (e) => {
      e.preventDefault?.()
      setOpenMenuId(null)
      setTimeout(action, 0)
    }
  }

  // ── Loading guard ─────────────────────────────────────────────────────────

  if (lists.length === 0 || !activeTab) {
    return (
      <div className="flex flex-col lg:h-full p-3 lg:p-4 gap-3">
        <div className="flex gap-4 border-b pb-2">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-8 w-20 rounded" />)}
        </div>
        <div className="space-y-2 px-1">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col lg:h-full p-3 lg:p-4">

      {/* ── Custom tab row ─────────────────────────────────────────────────── */}
      <div
        role="tablist"
        className="flex items-stretch border-b overflow-x-auto shrink-0"
        onPointerMove={onTabRowPointerMove}
        onPointerUp={onTabRowPointerUp}
        onPointerCancel={onTabRowPointerUp}
      >
        {lists.map(list => {
          const isActive   = activeTab === list.id
          const isDragged  = dragId === list.id
          const isOver     = dragOverId === list.id && dragId !== list.id
          const isEditing  = editingId === list.id
          const count      = uncheckedCount(list.id)

          return (
            <div
              key={list.id}
              ref={el => { tabRefs.current[list.id] = el }}
              data-tab-id={list.id}
              role="tab"
              aria-selected={isActive}
              draggable={!isEditing}
              onDragStart={e => onDragStart(e, list.id)}
              onDragOver={e => onDragOver(e, list.id)}
              onDrop={e => onDrop(e, list.id)}
              onDragEnd={onDragEnd}
              onPointerDown={e => {
                if (e.pointerType === "touch") onTabPointerDown(e, list.id)
              }}
              className={cn(
                "group relative flex items-center shrink-0",
                "border-b-2 -mb-px transition-colors cursor-default",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30",
                isDragged && "opacity-40",
                isOver    && "bg-primary/5 border-primary/50",
              )}
            >
              {isEditing ? (
                /* ── Inline edit ── */
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <input
                    autoFocus
                    value={editingName}
                    onChange={e => setEditingName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter")  commitRename()
                      if (e.key === "Escape") setEditingId(null)
                    }}
                    onBlur={commitRename}
                    className={cn(
                      "w-28 h-6 text-sm rounded border px-1.5 bg-background",
                      "focus:outline-none focus:ring-1 focus:ring-primary",
                    )}
                  />
                  <button
                    onMouseDown={e => e.preventDefault()}
                    onClick={commitRename}
                    className="h-5 w-5 flex items-center justify-center rounded text-primary hover:bg-primary/10"
                    aria-label="Save"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <button
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => setEditingId(null)}
                    className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
                    aria-label="Cancel"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <>
                  {/* ── Tab label (click to switch) ── */}
                  <button
                    onClick={() => setActiveTab(list.id)}
                    onPointerDown={e => e.stopPropagation()}
                    className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium"
                  >
                    {list.name}
                    {count > 0 && (
                      <span className={cn(
                        "inline-flex items-center justify-center rounded-full",
                        "text-[11px] font-bold min-w-[18px] h-[18px] px-1",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}>
                        {count}
                      </span>
                    )}
                  </button>

                  {/* ── Per-tab controls ── always on mobile, hover on desktop ── */}
                  <div className="flex items-center gap-0.5 pr-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={e => { e.stopPropagation(); startRename(list) }}
                      onPointerDown={e => e.stopPropagation()}
                      className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      aria-label="Rename list"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <DropdownMenu
                      open={openMenuId === list.id}
                      onOpenChange={o => setOpenMenuId(o ? list.id : null)}
                    >
                      <DropdownMenuTrigger
                        onClick={e => e.stopPropagation()}
                        onPointerDown={e => e.stopPropagation()}
                        className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        aria-label="List options"
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-[120px]">
                        <DropdownMenuItem
                          onSelect={tabMenuSelect(list.id, () => startRename(list))}
                        >
                          Rename
                        </DropdownMenuItem>
                        {lists.length > 1 && (
                          <DropdownMenuItem
                            onSelect={tabMenuSelect(list.id, () => setPendingDelete(list))}
                            className="text-destructive focus:text-destructive"
                          >
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </>
              )}
            </div>
          )
        })}

        {/* ── + New list button ── */}
        {lists.length < MAX_LISTS ? (
          <button
            onClick={() => { setCreateName(""); setCreateOpen(true) }}
            className={cn(
              "flex items-center gap-1 px-3 py-2.5 shrink-0 border-b-2 border-transparent -mb-px",
              "text-sm text-muted-foreground hover:text-foreground transition-colors",
            )}
            aria-label="New list"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline text-xs">New list</span>
          </button>
        ) : (
          <div
            title="Maximum 8 lists reached"
            className="flex items-center px-3 py-2.5 text-muted-foreground/30 cursor-not-allowed border-b-2 border-transparent -mb-px"
          >
            <Plus className="h-3.5 w-3.5" />
          </div>
        )}
      </div>

      {/* ── Tab panels ─────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {lists.map(list => (
          <div
            key={list.id}
            className={cn(
              "absolute inset-0 flex flex-col",
              activeTab !== list.id && "hidden",
            )}
          >
            <ErrorBoundary label={`${list.name} list`}>
              <ListPanel
                list={list}
                items={itemsForList(list.id)}
                loading={loading}
                onAdd={(n, q) => addItem(list.id, n, q)}
                onToggle={toggleItem}
                onDelete={deleteItem}
                onUpdate={updateItem}
                onClearCompleted={() => clearCompleted(list.id)}
                onClearAll={() => clearAll(list.id, list.name)}
              />
            </ErrorBoundary>
          </div>
        ))}
      </div>

      {/* ── Create list dialog ──────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New list</DialogTitle>
          </DialogHeader>
          <Input
            value={createName}
            onChange={e => setCreateName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCreateList() }}
            placeholder="List name…"
            autoFocus
            className="h-10"
          />
          <DialogFooter className="gap-2">
            <DialogClose>Cancel</DialogClose>
            <Button
              size="sm"
              onClick={handleCreateList}
              disabled={!createName.trim() || creating}
            >
              {creating && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation dialog ──────────────────────────────────────── */}
      <Dialog open={!!pendingDelete} onOpenChange={o => { if (!o) setPendingDelete(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete &quot;{pendingDelete?.name}&quot;?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently remove the list and all{" "}
            <strong>
              {pendingDelete ? itemsForList(pendingDelete.id).length : 0}
            </strong>{" "}
            item{pendingDelete && itemsForList(pendingDelete.id).length !== 1 ? "s" : ""} in it.
          </p>
          <DialogFooter className="gap-2">
            <DialogClose>Cancel</DialogClose>
            <Button variant="destructive" size="sm" onClick={handleDeleteList}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
}

function ListPanel({
  list, items, loading,
  onAdd, onToggle, onDelete, onUpdate, onClearCompleted, onClearAll,
}: ListPanelProps) {
  const [draft, setDraft]               = useState("")
  const [draftQty, setDraftQty]         = useState(1)
  const [adding, setAdding]             = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [clearAllOpen, setClearAllOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const unchecked = items.filter(i => !i.completed)
  const checked   = items.filter(i => i.completed)

  async function handleAdd() {
    const name = draft.trim()
    if (!name) return
    setAdding(true); setDraft(""); setDraftQty(1)
    await onAdd(name, draftQty)
    setAdding(false)
    inputRef.current?.focus()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function openDialog(action: () => void): (e: any) => void {
    return (e) => {
      e.preventDefault?.()
      setDropdownOpen(false)
      setTimeout(action, 0)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto">
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 pt-2 pb-1">
          <span className="text-xs text-muted-foreground">
            {unchecked.length} remaining · {checked.length} done
          </span>
          <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
            <DropdownMenuTrigger
              className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent transition-colors"
              aria-label="List options"
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={checked.length === 0}
                onSelect={onClearCompleted}
              >
                Clear completed ({checked.length})
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={items.length === 0}
                onSelect={openDialog(() => setClearAllOpen(true))}
                className="text-destructive focus:text-destructive"
              >
                Clear all ({items.length})
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {loading ? (
          <div className="px-4 py-4 space-y-2">
            {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <ShoppingCart className="h-10 w-10 opacity-30" />
            <p className="text-base font-medium">List is empty</p>
            <p className="text-sm">Add items using the input below.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {unchecked.map(item => (
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
            {checked.map(item => (
              <ItemRow key={item.id} item={item}
                onToggle={onToggle} onDelete={onDelete} onUpdate={onUpdate} />
            ))}
          </ul>
        )}
      </div>

      {/* Add item bar */}
      <div className="shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom,0px)]">
        {checked.length > 0 && (
          <div className="px-3 pt-2">
            <Button variant="outline" size="sm"
              className="w-full text-muted-foreground h-11 gap-1.5 text-sm"
              onClick={onClearCompleted}
            >
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
              onChange={e => setDraft(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && handleAdd()}
              placeholder={`Add to ${list.name}…`}
              className="flex-1 h-11 text-base"
            />
            <Button
              onClick={handleAdd}
              disabled={!draft.trim() || adding}
              className="h-11 px-4 shrink-0 gap-1.5"
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              <span className="hidden sm:inline">Add</span>
            </Button>
          </div>
          {draft.trim() && (
            <div className="flex items-center gap-2 animate-in fade-in duration-150">
              <Label className="text-xs text-muted-foreground shrink-0">Quantity</Label>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setDraftQty(q => Math.max(1, q - 1))}
                  className="h-7 w-7 rounded-md border text-sm font-bold hover:bg-muted transition-colors flex items-center justify-center">
                  −
                </button>
                <span className="w-8 text-center text-sm font-semibold tabular-nums">{draftQty}</span>
                <button type="button" onClick={() => setDraftQty(q => q + 1)}
                  className="h-7 w-7 rounded-md border text-sm font-bold hover:bg-muted transition-colors flex items-center justify-center">
                  +
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Clear all confirmation */}
      <Dialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Clear all items?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently remove all {items.length} item{items.length !== 1 ? "s" : ""} from{" "}
            <strong>{list.name}</strong>. This cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <DialogClose>Cancel</DialogClose>
            <Button variant="destructive" size="sm"
              onClick={() => { onClearAll(); setClearAllOpen(false) }}>
              Clear all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Item row ───────────────────────────────────────────────────────────────────

const LONG_PRESS_ITEM = 500

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
  const longPressTimer          = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didLongPress            = useRef(false)
  const editRef                 = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) { setEditName(item.name); setEditQty(item.quantity) }
  }, [item.name, item.quantity, editing])

  useEffect(() => { if (editing) editRef.current?.focus() }, [editing])

  function onPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0) return
    didLongPress.current = false
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true; setEditing(true)
    }, LONG_PRESS_ITEM)
  }
  function onPointerUp()     { if (longPressTimer.current) clearTimeout(longPressTimer.current) }
  function onPointerCancel() { if (longPressTimer.current) clearTimeout(longPressTimer.current) }
  function onContextMenu(e: React.MouseEvent) { e.preventDefault(); setEditing(true) }

  function commitEdit() {
    const name = editName.trim()
    const qty  = Math.max(1, editQty)
    if (name && (name !== item.name || qty !== item.quantity)) onUpdate(item, name, qty)
    setEditing(false)
  }

  function onEditKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter")  commitEdit()
    if (e.key === "Escape") { setEditing(false); setEditName(item.name); setEditQty(item.quantity) }
  }

  if (editing) {
    return (
      <li className="flex items-center gap-2 px-4 py-2 min-h-[52px] bg-accent/30">
        <Input ref={editRef} value={editName}
          onChange={e => setEditName(e.target.value)}
          onKeyDown={onEditKeyDown} onBlur={commitEdit}
          className="flex-1 h-9 text-base" aria-label="Edit item name" />
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onMouseDown={e => e.preventDefault()}
            onClick={() => setEditQty(q => Math.max(1, q - 1))}
            className="h-8 w-8 rounded-md border text-sm font-bold hover:bg-muted transition-colors flex items-center justify-center">
            −
          </button>
          <span className="w-7 text-center text-sm font-semibold tabular-nums">{editQty}</span>
          <button type="button" onMouseDown={e => e.preventDefault()}
            onClick={() => setEditQty(q => q + 1)}
            className="h-8 w-8 rounded-md border text-sm font-bold hover:bg-muted transition-colors flex items-center justify-center">
            +
          </button>
        </div>
        <Button size="sm" className="h-9 shrink-0" onMouseDown={e => e.preventDefault()} onClick={commitEdit}>
          Save
        </Button>
      </li>
    )
  }

  return (
    <li
      className={cn(
        "group flex items-center gap-3 px-4 transition-colors select-none min-h-[52px]",
        item.completed ? "bg-muted/20 hover:bg-muted/30" : "hover:bg-muted/10",
      )}
      onPointerDown={onPointerDown} onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel} onContextMenu={onContextMenu}
    >
      <Checkbox
        checked={item.completed}
        onCheckedChange={() => { if (!didLongPress.current) onToggle(item); didLongPress.current = false }}
        className={cn("h-5 w-5 shrink-0 rounded-full border-2 transition-all", item.completed && "opacity-50")}
        aria-label={`Mark ${item.name} ${item.completed ? "incomplete" : "complete"}`}
      />
      <span
        className={cn("flex-1 text-base lg:text-lg font-medium cursor-pointer", item.completed && "line-through text-muted-foreground")}
        onClick={() => { if (!didLongPress.current) onToggle(item); didLongPress.current = false }}
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
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onDelete(item) }}
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
