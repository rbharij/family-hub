"use client"

import { createContext, useContext, useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"

// ── Config ─────────────────────────────────────────────────────────────────────
const IDLE_TIMEOUT_MS = 300_000   // 5 minutes — change this constant to adjust
const COUNTDOWN_SECONDS = 5
const LS_ENABLED  = "idle-timeout-enabled"
const LS_DURATION = "idle-timeout-ms"

// ── Context ────────────────────────────────────────────────────────────────────
interface IdleCtx {
  enabled: boolean
  timeoutMs: number
  setEnabled: (v: boolean) => void
  setTimeoutMs: (v: number) => void
}

const Ctx = createContext<IdleCtx>({
  enabled: true,
  timeoutMs: IDLE_TIMEOUT_MS,
  setEnabled: () => {},
  setTimeoutMs: () => {},
})

export const useIdleTimeout = () => useContext(Ctx)

// ── Provider ───────────────────────────────────────────────────────────────────
export function IdleTimeoutProvider({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()

  const [enabled, setEnabledState] = useState<boolean>(() =>
    typeof window === "undefined" ? true : localStorage.getItem(LS_ENABLED) !== "false"
  )
  const [timeoutMs, setTimeoutMsState] = useState<number>(() =>
    typeof window === "undefined"
      ? IDLE_TIMEOUT_MS
      : parseInt(localStorage.getItem(LS_DURATION) ?? String(IDLE_TIMEOUT_MS), 10)
  )
  const [countdown, setCountdown] = useState<number | null>(null)
  const [inWallMode, setInWallMode] = useState(false)

  function setEnabled(v: boolean) {
    setEnabledState(v)
    localStorage.setItem(LS_ENABLED, String(v))
  }
  function setTimeoutMs(v: number) {
    setTimeoutMsState(v)
    localStorage.setItem(LS_DURATION, String(v))
  }

  // Mutable bundle — every piece of state that stable callbacks need to read or write
  const s = useRef({
    enabled,
    timeoutMs,
    pathname,
    inWallMode: false,
    savedPath: "/",
    savedScroll: 0,
    paused: false,
    cdActive: false,
    idleTimer: null as ReturnType<typeof setTimeout> | null,
    cdTimer:   null as ReturnType<typeof setTimeout> | null,
  })

  // Keep bundle in sync with React state each render
  s.current.enabled   = enabled
  s.current.timeoutMs = timeoutMs
  s.current.pathname  = pathname

  // Stable refs to React setters / router (they are already stable, but keep pattern consistent)
  const setCountdownR  = useRef(setCountdown);  setCountdownR.current  = setCountdown
  const setInWallModeR = useRef(setInWallMode); setInWallModeR.current = setInWallMode
  const routerR        = useRef(router);         routerR.current        = router

  // Detect when the user manually exits /wall (browser back / Exit button)
  useEffect(() => {
    if (s.current.inWallMode && pathname !== "/wall") {
      s.current.inWallMode = false
      setInWallModeR.current(false)
    }
  }, [pathname])

  // ── Core idle-timer logic ─────────────────────────────────────────────────
  useEffect(() => {
    const st = s.current

    function clearTimers() {
      if (st.idleTimer) { clearTimeout(st.idleTimer); st.idleTimer = null }
      if (st.cdTimer)   { clearTimeout(st.cdTimer);   st.cdTimer   = null }
    }

    function abortCountdown() {
      st.cdActive = false
      setCountdownR.current(null)
      if (st.cdTimer) { clearTimeout(st.cdTimer); st.cdTimer = null }
    }

    function startTimer() {
      clearTimers()
      if (!st.enabled || st.paused || st.pathname === "/wall") return
      const preCd = st.timeoutMs - COUNTDOWN_SECONDS * 1000
      if (preCd > 0) {
        st.idleTimer = setTimeout(beginCountdown, preCd)
      } else {
        st.idleTimer = setTimeout(activateWall, st.timeoutMs)
      }
    }

    function beginCountdown() {
      st.idleTimer = null
      st.cdActive  = true
      tick(COUNTDOWN_SECONDS)
    }

    function tick(n: number) {
      setCountdownR.current(n)
      if (n === 0) { activateWall(); return }
      st.cdTimer = setTimeout(() => { if (st.cdActive) tick(n - 1) }, 1000)
    }

    function activateWall() {
      st.cdActive = false
      setCountdownR.current(null)
      st.savedPath   = st.pathname
      st.savedScroll = window.scrollY
      st.inWallMode  = true
      setInWallModeR.current(true)
      routerR.current.push("/wall")
    }

    function exitWallMode() {
      st.inWallMode = false
      setInWallModeR.current(false)
      const { savedPath, savedScroll } = st
      routerR.current.push(savedPath)
      setTimeout(() => window.scrollTo(0, savedScroll), 150)
      startTimer()
    }

    function isTypingInInput() {
      const el = document.activeElement
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    }

    function onActivity(e: Event) {
      if (st.inWallMode) { exitWallMode(); return }
      if (e.type === "keydown" && isTypingInInput()) return
      if (st.cdActive) abortCountdown()
      startTimer()
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        st.paused = true
        clearTimers()
        if (st.cdActive) abortCountdown()
      } else {
        st.paused = false
        startTimer()
      }
    }

    if (!enabled) {
      clearTimers()
      if (st.cdActive) abortCountdown()
      return
    }

    const EVTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"] as const
    EVTS.forEach((ev) => document.addEventListener(ev, onActivity, { passive: true }))
    document.addEventListener("visibilitychange", onVisibilityChange)
    startTimer()

    return () => {
      EVTS.forEach((ev) => document.removeEventListener(ev, onActivity))
      document.removeEventListener("visibilitychange", onVisibilityChange)
      clearTimers()
      if (st.cdActive) abortCountdown()
    }
  }, [enabled, timeoutMs]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Ctx.Provider value={{ enabled, timeoutMs, setEnabled, setTimeoutMs }}>
      {children}

      {/*
        Transparent capture layer — sits above the wall display while in idle-wall-mode.
        Prevents accidental interaction with wall content and ensures our document-level
        mousedown/touchstart listeners see the first tap before any wall button click fires.
      */}
      {inWallMode && (
        <div className="fixed inset-0 z-[150]" aria-hidden />
      )}

      {/* Countdown overlay — shown 5 s before switching to wall display */}
      {countdown !== null && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="text-center text-white select-none pointer-events-none">
            <p className="text-3xl font-medium mb-6 opacity-80">
              Switching to wall display in
            </p>
            <p className="text-[140px] font-bold leading-none tabular-nums">
              {countdown}
            </p>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}
