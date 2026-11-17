"use client"

import Link from "next/link"
import { Settings } from "lucide-react"
import { Clock } from "@/components/clock"
import { ThemeToggle } from "@/components/theme-toggle"
import { ConnectionDot } from "@/components/connection-dot"
import { useAppSettings } from "@/lib/app-settings-context"

export function TopBar() {
  const { settings } = useAppSettings()
  const title = settings?.familyName ?? "Family Hub"

  return (
    <header className="lg:hidden grid grid-cols-3 items-center h-14 px-4 border-b border-border/70 bg-background/95 backdrop-blur shrink-0 sticky top-0 z-30 pt-safe">
      {/* Left — app title + connection status */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-display text-lg font-semibold tracking-tight truncate">
          {title}
        </span>
        <ConnectionDot />
      </div>

      {/* Centre — clock */}
      <div className="flex justify-center">
        <Clock />
      </div>

      {/* Right — settings + theme toggle */}
      <div className="flex justify-end items-center gap-1">
        <Link
          href="/settings"
          className="inline-flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Settings"
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </Link>
        <ThemeToggle />
      </div>
    </header>
  )
}
