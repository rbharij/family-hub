"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Calendar, ClipboardList, ShoppingCart, UtensilsCrossed, Monitor, Settings, MessageSquare } from "lucide-react"
import { cn } from "@/lib/utils"
import { useMessageCount } from "@/lib/message-count-context"

const MAIN_TABS = [
  { name: "Calendar", href: "/calendar",  icon: Calendar },
  { name: "Chores",   href: "/chores",    icon: ClipboardList },
  { name: "Shopping", href: "/shopping",  icon: ShoppingCart },
  { name: "Meals",    href: "/meals",     icon: UtensilsCrossed },
  { name: "Messages", href: "/messages",  icon: MessageSquare },
]

// ── Desktop: horizontal tabs below the top bar ────────────────────────────────
export function TopNavTabs() {
  const pathname = usePathname()
  const msgCount = useMessageCount()

  return (
    <nav className="hidden lg:flex shrink-0 border-b bg-background px-2 items-center">
      {MAIN_TABS.map(({ name, href, icon: Icon }) => {
        const active = pathname === href
        const isMsg  = href === "/messages"
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "relative flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors",
              active
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {name}
            {isMsg && msgCount > 0 && (
              <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold min-w-[16px] h-4 px-1">
                {msgCount > 99 ? "99+" : msgCount}
              </span>
            )}
          </Link>
        )
      })}

      {/* Right-side controls */}
      <div className="ml-auto flex items-center gap-2 mr-2">
        <Link
          href="/wall"
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border",
            pathname === "/wall"
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
        >
          <Monitor className="h-4 w-4 shrink-0" />
          Wall Display
        </Link>
      </div>
    </nav>
  )
}

// ── Mobile: fixed bottom tab bar ──────────────────────────────────────────────
export function BottomNavTabs() {
  const pathname = usePathname()
  const msgCount = useMessageCount()

  const ALL_TABS = [
    ...MAIN_TABS,
    { name: "Wall",     href: "/wall",     icon: Monitor },
    { name: "Settings", href: "/settings", icon: Settings },
  ]

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 flex lg:hidden border-t bg-background pb-safe">
      {ALL_TABS.map(({ name, href, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/")
        const isMsg  = href === "/messages"
        return (
          <Link
            key={href}
            href={href}
            title={name}
            aria-label={name}
            className={cn(
              "relative flex flex-1 flex-col items-center justify-center py-3 min-h-[44px] transition-colors",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Icon className={cn("h-5 w-5 transition-transform", active && "scale-110")} />
            {isMsg && msgCount > 0 && (
              <span className="absolute top-1.5 right-1/2 translate-x-3 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-bold min-w-[14px] h-3.5 px-0.5">
                {msgCount > 99 ? "99+" : msgCount}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
