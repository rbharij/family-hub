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
  const statusMap = useRef(new Map<string, ChannelStatus>())
  const [worstStatus, setWorstStatus] = useState<ChannelStatus>("connected")

  const reportStatus = useCallback((channelId: string, status: ChannelStatus) => {
    if (status === "connected") {
      statusMap.current.delete(channelId)
    } else {
      statusMap.current.set(channelId, status)
    }

    const statuses = Array.from(statusMap.current.values())
    if (statuses.includes("offline"))      setWorstStatus("offline")
    else if (statuses.includes("reconnecting")) setWorstStatus("reconnecting")
    else                                   setWorstStatus("connected")
  }, [])

  return (
    <ConnectionStatusContext.Provider value={{ worstStatus, reportStatus }}>
      {children}
    </ConnectionStatusContext.Provider>
  )
}
