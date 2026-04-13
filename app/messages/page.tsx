"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { X, ChevronDown, ChevronUp, Send, MessageSquare } from "lucide-react"
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
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

  // Load members and set persisted "me" selection
  useEffect(() => {
    supabase.from("family_members").select("id, name, avatar_emoji, color").order("created_at")
      .then(({ data }) => {
        const list = data ?? []
        setMembers(list)
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

  function selectMe(id: string) {
    setMyId(id)
    localStorage.setItem("messages-my-member-id", id)
  }

  const memberMap = new Map(members.map((m) => [m.id, m]))

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

      <Tabs defaultValue="for-me" className="flex flex-col flex-1 min-h-0">
        <TabsList variant="line"
          className="w-full justify-start border-b rounded-none px-0 h-auto pb-0 shrink-0 gap-0">
          <TabsTrigger value="for-me"
            className="rounded-none px-4 py-2.5 text-sm border-b-2 -mb-px">
            For Me
          </TabsTrigger>
          <TabsTrigger value="all"
            className="rounded-none px-4 py-2.5 text-sm border-b-2 -mb-px">
            All Messages
          </TabsTrigger>
        </TabsList>

        {/* ── For Me ─────────────────────────────────────────────────────── */}
        <TabsContent value="for-me" className="flex-1 min-h-0 overflow-y-auto mt-0 pt-3">
          {/* Member selector */}
          <div className="flex items-center gap-2 mb-4 px-1">
            <Label className="text-sm text-muted-foreground shrink-0">Viewing as:</Label>
            <Select value={myId} onValueChange={(v) => v && selectMe(v)}>
              <SelectTrigger className="w-48 h-8 text-sm">
                {myId
                  ? (() => {
                      const m = memberMap.get(myId)
                      return m
                        ? <span>{m.avatar_emoji} {m.name}</span>
                        : <span className="text-muted-foreground">Select…</span>
                    })()
                  : <span className="text-muted-foreground">Select…</span>}
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

          {loading ? <LoadingSkeletons /> : (
            myId
              ? <ForMePanel
                  myId={myId}
                  messages={messages}
                  memberMap={memberMap}
                  onDismiss={dismiss}
                />
              : <EmptyState icon="👤" text="Select a family member above to see your messages." />
          )}
        </TabsContent>

        {/* ── All Messages ────────────────────────────────────────────────── */}
        <TabsContent value="all" className="flex-1 min-h-0 overflow-y-auto mt-0 pt-3">
          {loading ? <LoadingSkeletons /> : (() => {
            const active = messages.filter((m) => !m.dismissed_at)
            if (active.length === 0)
              return <EmptyState icon="💬" text="No active messages — all caught up!" />

            // Group by recipient
            const groups = new Map<string, Message[]>()
            for (const msg of active) {
              const g = groups.get(msg.to_member_id) ?? []
              g.push(msg)
              groups.set(msg.to_member_id, g)
            }
            return (
              <div className="space-y-6 pb-4">
                {Array.from(groups.entries()).map(([toId, msgs]) => {
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
                })}
              </div>
            )
          })()}
        </TabsContent>
      </Tabs>

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

// ── For Me Panel ───────────────────────────────────────────────────────────────

function ForMePanel({
  myId, messages, memberMap, onDismiss,
}: {
  myId: string
  messages: Message[]
  memberMap: Map<string, Member>
  onDismiss: (id: string) => void
}) {
  const [showDismissed, setShowDismissed] = useState(false)
  const mine = messages.filter((m) => m.to_member_id === myId)
  const unread    = mine.filter((m) => !m.dismissed_at)
  const dismissed = mine.filter((m) => !!m.dismissed_at)

  if (mine.length === 0)
    return <EmptyState icon="📬" text="No messages for you yet." />

  return (
    <div className="space-y-6 pb-4">
      {unread.length === 0 ? (
        <EmptyState icon="✅" text="All caught up! No unread messages." />
      ) : (
        <div className="space-y-2">
          {unread.map((msg) => (
            <MessageCard key={msg.id} msg={msg} memberMap={memberMap} onDismiss={onDismiss} />
          ))}
        </div>
      )}

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
                <MessageCard key={msg.id} msg={msg} memberMap={memberMap} onDismiss={onDismiss} dismissed />
              ))}
            </div>
          )}
        </div>
      )}
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
  const [toId, setToId]     = useState("")
  const [body, setBody]     = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const MAX = 280

  useEffect(() => {
    if (open) { setToId(""); setBody(""); setError(null) }
  }, [open])

  async function handleSend() {
    if (!toId) { setError("Please select a recipient."); return }
    if (!body.trim()) { setError("Please enter a message."); return }
    setSending(true); setError(null)
    const { error } = await supabase.from("messages").insert({
      from_member_id: myId || null,
      to_member_id: toId,
      body: body.trim(),
    })
    setSending(false)
    if (error) { setError("Failed to send. Please try again."); return }
    onSent()
    onClose()
    toast.success("Message sent!")
  }

  const fromMember = members.find((m) => m.id === myId)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Message</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          {fromMember && (
            <div className="text-sm text-muted-foreground">
              From: <span className="font-medium text-foreground">
                {fromMember.avatar_emoji} {fromMember.name}
              </span>
            </div>
          )}
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
                {members.filter((m) => m.id !== myId).map((m) => (
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
