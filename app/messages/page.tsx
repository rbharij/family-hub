"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { X, ChevronDown, ChevronUp, Send } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase"
import { useRealtimeChannel } from "@/lib/use-realtime"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

// ── Types ──────────────────────────────────────────────────────────────────────

interface Member {
  id: string
  name: string
  avatar_emoji: string | null
  color: string | null
}

interface Message {
  id: string
  from_member_id: string | null
  to_member_id: string
  body: string
  created_at: string
  dismissed_at: string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const MSG_TABLES = [{ table: "messages" }] as const

function formatTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const msgDay = new Date(d); msgDay.setHours(0, 0, 0, 0)
  const time = d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true })
  if (msgDay.getTime() === today.getTime()) return time
  return `${d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })} ${time}`
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function MessagesPage() {
  const supabase = useRef(createClient()).current

  const [members, setMembers]     = useState<Member[]>([])
  const [messages, setMessages]   = useState<Message[]>([])
  const [loading, setLoading]     = useState(true)
  const [myId, setMyId]           = useState<string>("")
  const [composeOpen, setComposeOpen] = useState(false)
  const [filterIds, setFilterIds] = useState<Set<string>>(new Set())
  const [showDismissed, setShowDismissed] = useState(false)

  // Load members, set persisted "me" selection, and initialise all filters as selected
  useEffect(() => {
    supabase.from("family_members").select("id, name, avatar_emoji, color").order("created_at")
      .then(({ data }) => {
        const list = data ?? []
        setMembers(list)
        // All members selected by default
        setFilterIds(new Set(list.map((m) => m.id)))
        const saved = localStorage.getItem("messages-my-member-id")
        if (saved && list.some((m) => m.id === saved)) {
          setMyId(saved)
        } else if (list.length > 0) {
          setMyId(list[0].id)
          localStorage.setItem("messages-my-member-id", list[0].id)
        }
      })
  }, [supabase])

  const fetchMessages = useCallback(async () => {
    const { data } = await supabase
      .from("messages")
      .select("id, from_member_id, to_member_id, body, created_at, dismissed_at")
      .order("created_at", { ascending: false })
    setMessages(data ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchMessages() }, [fetchMessages])
  useRealtimeChannel(supabase, "messages-page", MSG_TABLES, fetchMessages)

  // ── Actions ────────────────────────────────────────────────────────────────

  async function dismiss(id: string) {
    const now = new Date().toISOString()
    setMessages((prev) => prev.map((m) => m.id === id ? { ...m, dismissed_at: now } : m))
    const { error } = await supabase.from("messages").update({ dismissed_at: now }).eq("id", id)
    if (error) {
      setMessages((prev) => prev.map((m) => m.id === id ? { ...m, dismissed_at: null } : m))
      toast.error("Couldn't dismiss message.")
    }
  }

  function toggleFilter(id: string) {
    setFilterIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const memberMap = new Map(members.map((m) => [m.id, m]))

  // If no filters selected, show all; otherwise filter by selected recipients
  const filtered = filterIds.size === 0
    ? messages
    : messages.filter((m) => filterIds.has(m.to_member_id))

  const active    = filtered.filter((m) => !m.dismissed_at)
  const dismissed = filtered.filter((m) => !!m.dismissed_at)

  // Group active by recipient
  const activeGroups = new Map<string, Message[]>()
  for (const msg of active) {
    const g = activeGroups.get(msg.to_member_id) ?? []
    g.push(msg)
    activeGroups.set(msg.to_member_id, g)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full p-3 lg:p-4 gap-3">
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0">
        <h1 className="text-xl font-bold flex-1">Messages</h1>
        <Button size="sm" className="gap-1.5" onClick={() => setComposeOpen(true)}>
          <Send className="h-3.5 w-3.5" />
          Compose
        </Button>
      </div>

      {/* Member filter buttons */}
      {members.length > 0 && (
        <div className="flex flex-wrap gap-2 shrink-0">
          {members.map((m) => {
            const selected = filterIds.has(m.id)
            return (
              <button
                key={m.id}
                onClick={() => toggleFilter(m.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition-all border-2",
                  !selected && "opacity-40",
                )}
                style={{
                  backgroundColor: selected && m.color ? `${m.color}20` : undefined,
                  color: selected && m.color ? m.color : undefined,
                  borderColor: selected && m.color ? m.color : "transparent",
                }}
              >
                {m.avatar_emoji && <span>{m.avatar_emoji}</span>}
                {m.name}
              </button>
            )
          })}
        </div>
      )}

      {/* Messages list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <LoadingSkeletons />
        ) : active.length === 0 && dismissed.length === 0 ? (
          <EmptyState icon="💬" text="No messages — all caught up!" />
        ) : (
          <div className="space-y-6 pb-4">
            {/* Active messages grouped by recipient */}
            {active.length === 0 ? (
              <EmptyState icon="✅" text="All caught up! No active messages." />
            ) : (
              Array.from(activeGroups.entries()).map(([toId, msgs]) => {
                const recipient = memberMap.get(toId)
                return (
                  <div key={toId}>
                    <MemberChip member={recipient} className="mb-2" />
                    <div className="space-y-2">
                      {msgs.map((msg) => (
                        <MessageCard
                          key={msg.id}
                          msg={msg}
                          memberMap={memberMap}
                          onDismiss={dismiss}
                        />
                      ))}
                    </div>
                  </div>
                )
              })
            )}

            {/* Collapsible dismissed section */}
            {dismissed.length > 0 && (
              <div>
                <button
                  onClick={() => setShowDismissed((v) => !v)}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
                >
                  {showDismissed
                    ? <ChevronUp className="h-4 w-4" />
                    : <ChevronDown className="h-4 w-4" />}
                  {dismissed.length} dismissed message{dismissed.length !== 1 ? "s" : ""}
                </button>
                {showDismissed && (
                  <div className="space-y-2 opacity-60">
                    {dismissed.map((msg) => (
                      <MessageCard
                        key={msg.id}
                        msg={msg}
                        memberMap={memberMap}
                        onDismiss={dismiss}
                        dismissed
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Compose dialog */}
      <ComposeDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        members={members}
        myId={myId}
        onSent={fetchMessages}
      />
    </div>
  )
}

// ── Message card ───────────────────────────────────────────────────────────────

function MessageCard({
  msg, memberMap, onDismiss, dismissed = false,
}: {
  msg: Message
  memberMap: Map<string, Member>
  onDismiss: (id: string) => void
  dismissed?: boolean
}) {
  const sender = msg.from_member_id ? memberMap.get(msg.from_member_id) : null
  return (
    <div className={cn(
      "relative rounded-lg border bg-card p-3 pr-9",
      dismissed && "border-dashed",
    )}>
      <p className="text-base font-medium leading-snug">{msg.body}</p>
      <p className="text-xs text-muted-foreground mt-1.5">
        {sender ? `From ${sender.avatar_emoji ?? ""} ${sender.name} · ` : ""}
        {formatTime(msg.created_at)}
      </p>
      {!dismissed && (
        <button
          onClick={() => onDismiss(msg.id)}
          className="absolute top-2.5 right-2.5 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

// ── Member chip ────────────────────────────────────────────────────────────────

function MemberChip({ member, className }: { member: Member | undefined; className?: string }) {
  if (!member) return null
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold", className)}
      style={{
        backgroundColor: member.color ? `${member.color}20` : undefined,
        color: member.color ?? undefined,
      }}
    >
      {member.avatar_emoji && <span>{member.avatar_emoji}</span>}
      {member.name}
    </span>
  )
}

// ── Compose dialog ─────────────────────────────────────────────────────────────

function ComposeDialog({
  open, onClose, members, myId, onSent,
}: {
  open: boolean
  onClose: () => void
  members: Member[]
  myId: string
  onSent: () => void
}) {
  const supabase = useRef(createClient()).current
  const [fromId, setFromId]   = useState(myId)
  const [toId, setToId]       = useState("")
  const [body, setBody]       = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const MAX = 280

  useEffect(() => {
    if (open) { setFromId(myId); setToId(""); setBody(""); setError(null) }
  }, [open, myId])

  async function handleSend() {
    if (!fromId) { setError("Please select who this is from."); return }
    if (!toId) { setError("Please select a recipient."); return }
    if (!body.trim()) { setError("Please enter a message."); return }
    setSending(true); setError(null)
    const { error } = await supabase.from("messages").insert({
      from_member_id: fromId || null,
      to_member_id: toId,
      body: body.trim(),
    })
    setSending(false)
    if (error) { setError("Failed to send. Please try again."); return }
    onSent()
    onClose()
    toast.success("Message sent!")
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Message</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>From</Label>
            <Select value={fromId} onValueChange={(v) => v && setFromId(v)}>
              <SelectTrigger>
                {fromId
                  ? (() => {
                      const m = members.find((x) => x.id === fromId)
                      return m
                        ? <span>{m.avatar_emoji} {m.name}</span>
                        : <span className="text-muted-foreground">Select sender…</span>
                    })()
                  : <span className="text-muted-foreground">Select sender…</span>}
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.avatar_emoji} {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>To</Label>
            <Select value={toId} onValueChange={(v) => v && setToId(v)}>
              <SelectTrigger>
                {toId
                  ? (() => {
                      const m = members.find((x) => x.id === toId)
                      return m
                        ? <span>{m.avatar_emoji} {m.name}</span>
                        : <span className="text-muted-foreground">Select recipient…</span>
                    })()
                  : <span className="text-muted-foreground">Select recipient…</span>}
              </SelectTrigger>
              <SelectContent>
                {members.filter((m) => m.id !== fromId).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.avatar_emoji} {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="msg-body">Message</Label>
              <span className={cn(
                "text-xs tabular-nums",
                body.length > MAX * 0.9 ? "text-destructive" : "text-muted-foreground",
              )}>
                {body.length}/{MAX}
              </span>
            </div>
            <Textarea
              id="msg-body"
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, MAX))}
              placeholder="Write your message…"
              rows={3}
              autoFocus
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button size="sm" onClick={handleSend} disabled={sending || !body.trim() || !toId}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
      <span className="text-4xl">{icon}</span>
      <p className="text-base text-center max-w-xs">{text}</p>
    </div>
  )
}

function LoadingSkeletons() {
  return (
    <div className="space-y-3 pt-2">
      {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
    </div>
  )
}
