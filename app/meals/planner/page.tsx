"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, ChevronLeft, ChevronRight, CalendarDays, Snowflake, SlidersHorizontal } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { ErrorBoundary } from "@/components/error-boundary"
import { cn } from "@/lib/utils"
import { addDays, startOfWeek, toDateStr } from "../_utils"
import { PlanView } from "./_plan-view"
import { FreezerView } from "./_freezer-view"
import { SetupView } from "./_setup-view"

type Tab = "plan" | "freezer" | "setup"

const TABS: { key: Tab; label: string; icon: typeof CalendarDays }[] = [
  { key: "plan",    label: "Week plan", icon: CalendarDays },
  { key: "freezer", label: "Freezer",   icon: Snowflake },
  { key: "setup",   label: "Setup",     icon: SlidersHorizontal },
]

export default function MealPlannerPage() {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  // Default to next week from Friday onwards, otherwise this week
  const [weekStart, setWeekStart] = useState(() => {
    const thisWeek = startOfWeek(today)
    return today.getDay() === 5 || today.getDay() === 6 || today.getDay() === 0
      ? addDays(thisWeek, 7)
      : thisWeek
  })
  const [tab, setTab] = useState<Tab>("plan")

  const weekEnd   = addDays(weekStart, 6)
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }
  const weekLabel = `${weekStart.toLocaleDateString("en-GB", opts)} to ${weekEnd.toLocaleDateString("en-GB", opts)}`
  const isThisWeek = toDateStr(weekStart) === toDateStr(startOfWeek(today))
  const isNextWeek = toDateStr(weekStart) === toDateStr(addDays(startOfWeek(today), 7))

  return (
    <div className="flex flex-col p-4 lg:px-8 lg:py-7 gap-4 lg:gap-5">
      <div className="flex items-center gap-2 lg:gap-3 flex-wrap">
        <Link href="/meals" className={cn(buttonVariants({ variant: "outline", size: "icon" }), "size-11 rounded-xl bg-card")} aria-label="Back to meals">
          <ArrowLeft className="size-5" />
        </Link>
        <div className="mr-1 lg:mr-2">
          <h1 className="font-display text-[26px] lg:text-[34px] font-semibold tracking-tight leading-tight">Meal planner</h1>
          <p className="text-[14px] lg:text-[15px] text-muted-foreground">
            {tab === "plan" ? `${weekLabel}${isThisWeek ? " · this week" : isNextWeek ? " · next week" : ""}` : "Plan, freezer and family preferences"}
          </p>
        </div>

        {tab === "plan" && (
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon" className="size-11 rounded-xl bg-card" onClick={() => setWeekStart((w) => addDays(w, -7))} aria-label="Previous week">
              <ChevronLeft className="size-5" />
            </Button>
            <Button variant="outline" size="icon" className="size-11 rounded-xl bg-card" onClick={() => setWeekStart((w) => addDays(w, 7))} aria-label="Next week">
              <ChevronRight className="size-5" />
            </Button>
          </div>
        )}

        <div className="ml-auto flex rounded-2xl bg-secondary p-1 gap-1" role="tablist">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3.5 h-10 text-[14px] font-semibold transition-colors",
                tab === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <ErrorBoundary label="Meal planner">
        {tab === "plan"    && <PlanView weekStart={toDateStr(weekStart)} onOpenSetup={() => setTab("setup")} />}
        {tab === "freezer" && <FreezerView />}
        {tab === "setup"   && <SetupView />}
      </ErrorBoundary>
    </div>
  )
}
