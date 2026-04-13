"use client"

import { useEffect, useState } from "react"

const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
]
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

export function Clock() {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  if (!now) return <div className="w-28 sm:w-36" /> // reserve space during SSR

  const hh = String(now.getHours()).padStart(2, "0")
  const mm = String(now.getMinutes()).padStart(2, "0")
  const day = DAYS[now.getDay()]
  const dd = now.getDate()
  const month = MONTHS[now.getMonth()]
  const yyyy = now.getFullYear()

  return (
    <div className="flex flex-col items-center tabular-nums select-none">
      <span className="text-xl sm:text-2xl font-bold leading-none tracking-tight">
        {hh}:{mm}
      </span>
      <span className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 whitespace-nowrap">
        {day}, {dd} {month} {yyyy}
      </span>
    </div>
  )
}
