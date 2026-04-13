"use client"

import { createContext, useContext, useEffect, useRef, useState } from "react"

export type ThemeMode = "light" | "dark" | "auto"

interface ThemeContextValue {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  darkFromHour: number
  lightFromHour: number
  updateThemeHours: (darkFrom: number, lightFrom: number) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "auto",
  setMode: () => {},
  darkFromHour: 19,
  lightFromHour: 7,
  updateThemeHours: () => {},
})

export function useTheme() {
  return useContext(ThemeContext)
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isDarkHour(darkFrom: number, lightFrom: number): boolean {
  const h = new Date().getHours()
  return h >= darkFrom || h < lightFrom
}

function applyTheme(mode: ThemeMode, darkFrom: number, lightFrom: number): void {
  const dark = mode === "dark" || (mode === "auto" && isDarkHour(darkFrom, lightFrom))
  document.documentElement.classList.toggle("dark", dark)
}

function midnightTonight(): number {
  const d = new Date()
  d.setHours(24, 0, 0, 0)
  return d.getTime()
}

const STORAGE_MODE      = "theme-mode"
const STORAGE_OVERRIDE  = "theme-override-until"
const STORAGE_DARK_FROM = "dark-from-hour"
const STORAGE_LIGHT_FROM = "light-from-hour"

// ── Provider ───────────────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState]         = useState<ThemeMode>("auto")
  const [darkFromHour, setDarkFrom]  = useState(19)
  const [lightFromHour, setLightFrom] = useState(7)

  const modeRef      = useRef<ThemeMode>("auto")
  const darkFromRef  = useRef(19)
  const lightFromRef = useRef(7)
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Initialise from localStorage ─────────────────────────────────────────

  useEffect(() => {
    let stored = (localStorage.getItem(STORAGE_MODE) as ThemeMode) || "auto"
    const overrideStr = localStorage.getItem(STORAGE_OVERRIDE)
    if (overrideStr && Date.now() > parseInt(overrideStr, 10)) {
      stored = "auto"
      localStorage.setItem(STORAGE_MODE, "auto")
      localStorage.removeItem(STORAGE_OVERRIDE)
    }

    const df = parseInt(localStorage.getItem(STORAGE_DARK_FROM) ?? "19", 10)
    const lf = parseInt(localStorage.getItem(STORAGE_LIGHT_FROM) ?? "7", 10)

    modeRef.current      = stored
    darkFromRef.current  = df
    lightFromRef.current = lf
    setModeState(stored)
    setDarkFrom(df)
    setLightFrom(lf)
    applyTheme(stored, df, lf)
  }, [])

  // ── 60-second interval: auto-tick + midnight reset ────────────────────────

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      const overrideStr = localStorage.getItem(STORAGE_OVERRIDE)
      if (overrideStr && Date.now() > parseInt(overrideStr, 10)) {
        localStorage.setItem(STORAGE_MODE, "auto")
        localStorage.removeItem(STORAGE_OVERRIDE)
        modeRef.current = "auto"
        setModeState("auto")
        applyTheme("auto", darkFromRef.current, lightFromRef.current)
        return
      }
      if (modeRef.current === "auto") {
        applyTheme("auto", darkFromRef.current, lightFromRef.current)
      }
    }, 60_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  useEffect(() => {
    applyTheme(mode, darkFromRef.current, lightFromRef.current)
  }, [mode])

  // ── setMode ───────────────────────────────────────────────────────────────

  function setMode(next: ThemeMode) {
    const prev = modeRef.current
    if (next === "auto") {
      localStorage.removeItem(STORAGE_OVERRIDE)
    } else if (prev === "auto") {
      localStorage.setItem(STORAGE_OVERRIDE, String(midnightTonight()))
    }
    modeRef.current = next
    setModeState(next)
    localStorage.setItem(STORAGE_MODE, next)
  }

  // ── updateThemeHours (called by settings page) ────────────────────────────

  function updateThemeHours(darkFrom: number, lightFrom: number) {
    darkFromRef.current  = darkFrom
    lightFromRef.current = lightFrom
    setDarkFrom(darkFrom)
    setLightFrom(lightFrom)
    localStorage.setItem(STORAGE_DARK_FROM,  String(darkFrom))
    localStorage.setItem(STORAGE_LIGHT_FROM, String(lightFrom))
    applyTheme(modeRef.current, darkFrom, lightFrom)
  }

  return (
    <ThemeContext.Provider value={{ mode, setMode, darkFromHour, lightFromHour, updateThemeHours }}>
      {children}
    </ThemeContext.Provider>
  )
}
