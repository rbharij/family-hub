"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase"

// ── Context ────────────────────────────────────────────────────────────────────

const MessageCountContext = createContext<number>(0)

export function useMessageCount(): number {
  return useContext(MessageCountContext)
}

// ── Provider — mount once in the layout ───────────────────────────────────────

export function MessageCountProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0)
  const supabase = useRef(createClient()).current

  const fetchCount = useCallback(async () => {
    const { count: n } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .is("dismissed_at", null)
    setCount(n ?? 0)
  }, [supabase])

  useEffect(() => { fetchCount() }, [fetchCount])

  // Single realtime subscription for the whole app
  useEffect(() => {
    const channel = supabase
      .channel("messages-badge-singleton")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        fetchCount,
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [supabase, fetchCount])

  return (
    <MessageCountContext.Provider value={count}>
      {children}
    </MessageCountContext.Provider>
  )
}
