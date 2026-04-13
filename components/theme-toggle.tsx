"use client"

import { Moon, Sun, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme, type ThemeMode } from "@/components/theme-provider"

// Light → Dark → Auto → (back to Light)
const cycle: ThemeMode[] = ["light", "dark", "auto"]

const CONFIG = {
  light: { icon: Sun,   label: "Light" },
  dark:  { icon: Moon,  label: "Dark"  },
  auto:  { icon: Clock, label: "Auto"  },
} as const

export function ThemeToggle() {
  const { mode, setMode } = useTheme()

  function handleClick() {
    const next = cycle[(cycle.indexOf(mode) + 1) % cycle.length]
    setMode(next)
  }

  const { icon: Icon, label } = CONFIG[mode]

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      className="gap-1.5 px-2 sm:px-3"
      aria-label={`Theme: ${label}. Click to cycle.`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="hidden sm:inline text-xs font-medium">{label}</span>
    </Button>
  )
}
