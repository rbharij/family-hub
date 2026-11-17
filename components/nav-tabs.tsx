"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Calendar, ClipboardList, ShoppingCart, UtensilsCrossed, Monitor, Settings,
  MessageSquare, Sprout, BookOpen, Home, MoreHorizontal, type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useMessageCount } from "@/lib/message-count-context"
import { useAppSettings } from "@/lib/app-settings-context"
import { Clock } from "@/components/clock"
import { ThemeToggle } from "@/components/theme-toggle"
import { ConnectionDot } from "@/components/connection-dot"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"

interface Tab { name: string; href: string; icon: LucideIcon }

const MAIN_TABS: Tab[] = [
  { name: "Calendar", href: "/calendar", icon: Calendar },
  { name: "Tasks",    href: "/chores",   icon: ClipboardList },
  { name: "Meals",    href: "/meals",    icon: UtensilsCrossed },
  { name: "Recipes",  href: "/recipes",  icon: BookOpen },
  { name: "Shopping", href: "/shopping", icon: ShoppingCart },
  { name: "Plants",   href: "/plants",   icon: Sprout },
  { name: "Messages", href: "/messages", icon: MessageSquare },
]

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/")
}

function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] font-semibold min-w-[20px] h-5 px-1.5 tabular-nums",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}

// ── Desktop / tablet (lg+): left sidebar ──────────────────────────────────────
export function Sidebar() {
  const pathname = usePathname()
  const msgCount = useMessageCount()
  const { settings } = useAppSettings()
  const title = settings?.familyName ?? "Family Hub"

  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col gap-6 bg-sidebar px-4 pt-6 pb-5 border-r border-border/60">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-2">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Home className="size-5" />
        </span>
        <span className="font-display text-xl font-semibold tracking-tight truncate">{title}</span>
        <ConnectionDot />
      </div>

      {/* Clock */}
      <div className="px-2">
        <Clock variant="sidebar" />
      </div>

      {/* Navigation */}
      <nav aria-label="Main" className="flex flex-col gap-1">
        {MAIN_TABS.map(({ name, href, icon: Icon }) => {
          const active = isActive(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 min-h-[46px] px-3 rounded-xl text-[15px] transition-colors",
                active
                  ? "bg-card text-accent-foreground font-semibold shadow-sm"
                  : "text-foreground/75 font-medium hover:bg-card/60 hover:text-foreground",
              )}
            >
              <Icon className={cn("size-5 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
              <span className="flex-1">{name}</span>
              {href === "/messages" && <CountBadge count={msgCount} />}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="mt-auto flex flex-col gap-3">
        <Link
          href="/wall"
          className="flex items-center justify-center gap-2 min-h-[48px] rounded-xl bg-foreground text-background text-[15px] font-semibold hover:opacity-90 transition-opacity"
        >
          <Monitor className="size-[18px]" />
          Wall display
        </Link>
        <div className="flex items-center justify-between px-1">
          <ThemeToggle />
          <Link
            href="/settings"
            aria-label="Settings"
            aria-current={isActive(pathname, "/settings") ? "page" : undefined}
            className={cn(
              "inline-flex items-center justify-center size-10 rounded-xl transition-colors",
              isActive(pathname, "/settings")
                ? "bg-card text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-card/60",
            )}
          >
            <Settings className="size-5" />
          </Link>
        </div>
      </div>
    </aside>
  )
}

// ── Mobile: bottom tab bar with a "More" sheet ────────────────────────────────
const PRIMARY_MOBILE = ["/calendar", "/chores", "/meals", "/shopping"]

export function BottomNavTabs() {
  const pathname = usePathname()
  const msgCount = useMessageCount()
  const [moreOpen, setMoreOpen] = useState(false)

  const primary = MAIN_TABS.filter(t => PRIMARY_MOBILE.includes(t.href))
  const secondary: Tab[] = [
    ...MAIN_TABS.filter(t => !PRIMARY_MOBILE.includes(t.href)),
    { name: "Wall display", href: "/wall", icon: Monitor },
    { name: "Settings", href: "/settings", icon: Settings },
  ]
  const moreActive = secondary.some(t => isActive(pathname, t.href))

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed bottom-0 inset-x-0 z-40 grid grid-cols-5 lg:hidden border-t border-border bg-card/95 backdrop-blur pb-safe px-2 pt-1.5"
      >
        {primary.map(({ name, href, icon: Icon }) => {
          const active = isActive(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className="flex flex-col items-center justify-center gap-1 min-h-[52px] text-[11px] font-semibold"
            >
              <span className={cn(
                "flex items-center justify-center h-7 w-12 rounded-full transition-colors",
                active ? "bg-accent text-accent-foreground" : "text-muted-foreground",
              )}>
                <Icon className="size-5" />
              </span>
              <span className={active ? "text-accent-foreground" : "text-muted-foreground"}>{name}</span>
            </Link>
          )
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label={msgCount > 0 ? `More, ${msgCount} new messages` : "More"}
          className="relative flex flex-col items-center justify-center gap-1 min-h-[52px] text-[11px] font-semibold"
        >
          <span className={cn(
            "flex items-center justify-center h-7 w-12 rounded-full transition-colors",
            moreActive ? "bg-accent text-accent-foreground" : "text-muted-foreground",
          )}>
            <MoreHorizontal className="size-5" />
          </span>
          <span className={moreActive ? "text-accent-foreground" : "text-muted-foreground"}>More</span>
          {msgCount > 0 && <CountBadge count={msgCount} className="absolute top-0 right-1/2 translate-x-6" />}
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl px-4 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <SheetTitle className="font-display text-lg font-semibold px-1">More</SheetTitle>
          <div className="grid grid-cols-3 gap-2">
            {secondary.map(({ name, href, icon: Icon }) => {
              const active = isActive(pathname, href)
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex flex-col items-center justify-center gap-2 rounded-2xl min-h-[88px] text-sm font-semibold transition-colors",
                    active ? "bg-accent text-accent-foreground" : "bg-muted/60 text-foreground hover:bg-muted",
                  )}
                >
                  <Icon className="size-6" />
                  {name}
                  {href === "/messages" && <CountBadge count={msgCount} className="absolute top-2 right-2" />}
                </Link>
              )
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
