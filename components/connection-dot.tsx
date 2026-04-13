"use client"

import { cn } from "@/lib/utils"
import { useConnectionStatus } from "@/lib/connection-status"

const CONFIG = {
  connected:    { label: null,            dot: null },
  reconnecting: { label: "Reconnecting…", dot: "bg-amber-400" },
  offline:      { label: "Offline",       dot: "bg-red-500"   },
} as const

/**
 * Small dot + label that appears in the TopBar only when the realtime
 * connection is degraded. Hidden entirely when all channels are healthy.
 */
export function ConnectionDot() {
  const { worstStatus } = useConnectionStatus()
  const config = CONFIG[worstStatus]

  if (!config.dot) return null

  return (
    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      {/* Pulsing dot */}
      <span className="relative flex h-2 w-2">
        <span
          className={cn(
            "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
            config.dot,
          )}
        />
        <span
          className={cn(
            "relative inline-flex rounded-full h-2 w-2",
            config.dot,
          )}
        />
      </span>
      <span className="hidden sm:inline">{config.label}</span>
    </div>
  )
}
