"use client"

/**
 * Global connection status context.
 *
 * Each realtime channel reports its own status here via reportStatus().
 * The context derives `worstStatus` from all active channels so the
 * TopBar indicator always reflects the most degraded connection state.
 *
 * When a component unmounts it should call reportStatus(id, "connected")
 * to remove its entry from the aggregate — "connected" is treated as
 * "no issue from this channel".
 *
 * Degraded states (offline / reconnecting) are debounced by DEGRADED_DELAY_MS
 * so brief websocket hiccups during initial connection don't flash the indicator.
 * Recovery back to connected is always immediate.
 */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react"

export type ChannelStatus = "connected" | "reconnecting" | "offline"

// Only show the indicator if the degraded state persists longer than this.
const DEGRADED_DELAY_MS = 5_000

interface ConnectionStatusContextValue {
  worstStatus: ChannelStatus
  reportStatus: (channelId: string, status: ChannelStatus) => void
}

const ConnectionStatusContext = createContext<ConnectionStatusContextValue>({
  worstStatus: "connected",
  reportStatus: () => {},
})

export function useConnectionStatus() {
  return useContext(ConnectionStatusContext)
}

export function ConnectionStatusProvider({ children }: { children: ReactNode }) {
  const statusMap    = useRef(new Map<string, ChannelStatus>())
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [worstStatus, setWorstStatus] = useState<ChannelStatus>("connected")

  const reportStatus = useCallback((channelId: string, status: ChannelStatus) => {
    if (status === "connected") {
      statusMap.current.delete(channelId)
    } else {
      statusMap.current.set(channelId, status)
    }

    const statuses = Array.from(statusMap.current.values())
    const worst: ChannelStatus =
      statuses.includes("offline")       ? "offline"      :
      statuses.includes("reconnecting")  ? "reconnecting" :
                                           "connected"

    if (worst === "connected") {
      // Recover immediately and cancel any pending degraded timer.
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
      setWorstStatus("connected")
    } else {
      // Only flip to degraded after a delay — ignore brief transient drops.
      if (!debounceRef.current) {
        debounceRef.current = setTimeout(() => {
          debounceRef.current = null
          const current = Array.from(statusMap.current.values())
          const w: ChannelStatus =
            current.includes("offline")      ? "offline"      :
            current.includes("reconnecting") ? "reconnecting" :
                                               "connected"
          setWorstStatus(w)
        }, DEGRADED_DELAY_MS)
      }
    }
  }, [])

  return (
    <ConnectionStatusContext.Provider value={{ worstStatus, reportStatus }}>
      {children}
    </ConnectionStatusContext.Provider>
  )
}
