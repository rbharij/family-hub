"use client"

/**
 * useRealtimeChannel — managed Supabase realtime subscription.
 *
 * Features:
 *  - Subscribes to one or more postgres_changes table events.
 *  - Reports connection status to the global ConnectionStatusContext.
 *  - On disconnect (CLOSED / CHANNEL_ERROR / TIMED_OUT), schedules a
 *    reconnect with exponential backoff: 5s → 10s → 20s → 30s cap.
 *  - On reconnection, triggers `onData()` to re-fetch and catch up with
 *    changes made while offline.
 *  - Cleans up properly on unmount (cancels timers, unsubscribes).
 */

import { useEffect, useRef } from "react"
import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js"
import { useConnectionStatus, type ChannelStatus } from "./connection-status"

export interface TableConfig {
  table: string
  schema?: string    // default: "public"
  event?: "*" | "INSERT" | "UPDATE" | "DELETE"  // default: "*"
}

// Backoff delays in ms: attempt 0 → 5s, 1 → 10s, 2 → 20s, 3+ → 30s
const BACKOFF_MS = [5_000, 10_000, 20_000, 30_000]

export function useRealtimeChannel(
  supabase: SupabaseClient,
  channelName: string,
  tables: readonly TableConfig[],
  onData: () => void,
) {
  const { reportStatus } = useConnectionStatus()

  // Keep mutable refs so the subscribe closure always sees the latest values
  // without needing to re-register the channel on every render.
  const onDataRef    = useRef(onData)
  const reportRef    = useRef(reportStatus)
  onDataRef.current  = onData
  reportRef.current  = reportStatus

  const channelRef   = useRef<RealtimeChannel | null>(null)
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptRef   = useRef(0)
  // True once we have received at least one SUBSCRIBED event
  const connectedRef = useRef(false)
  const deadRef      = useRef(false) // set true on unmount

  // Store the subscribe function in a ref so the setTimeout callback always
  // invokes the latest version (avoids stale-closure loops).
  const doSubscribeRef = useRef<() => void>()

  doSubscribeRef.current = function doSubscribe() {
    if (deadRef.current) return

    // Fully remove existing channel from Supabase's registry before creating a new one.
    // .unsubscribe() alone leaves it in the registry; supabase.channel() would then
    // return the already-subscribed instance, making .on() throw.
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }

    let ch = supabase.channel(channelName)

    for (const t of tables) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ch = (ch as any).on(
        "postgres_changes",
        {
          event:  t.event  ?? "*",
          schema: t.schema ?? "public",
          table:  t.table,
        },
        () => onDataRef.current(),
      )
    }

    ch.subscribe((status: string) => {
      if (deadRef.current) return

      if (status === "SUBSCRIBED") {
        // Re-fetch only when recovering from a disruption, not on initial connect
        const isRecovery = connectedRef.current && attemptRef.current > 0
        connectedRef.current = true
        attemptRef.current   = 0
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
        reportRef.current(channelName, "connected")
        if (isRecovery) onDataRef.current()

      } else if (
        status === "CHANNEL_ERROR" ||
        status === "CLOSED"        ||
        status === "TIMED_OUT"
      ) {
        const s: ChannelStatus =
          status === "TIMED_OUT" ? "reconnecting" : "offline"
        reportRef.current(channelName, s)

        // Schedule reconnect with exponential backoff
        if (timerRef.current) clearTimeout(timerRef.current)
        const delay = BACKOFF_MS[Math.min(attemptRef.current, BACKOFF_MS.length - 1)]
        attemptRef.current++
        timerRef.current = setTimeout(() => doSubscribeRef.current?.(), delay)
      }
    })

    channelRef.current = ch
  }

  useEffect(() => {
    deadRef.current = false
    doSubscribeRef.current?.()

    return () => {
      deadRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      reportRef.current(channelName, "connected")
    }
    // supabase and channelName are stable references; tables are module-level constants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, channelName])
}
