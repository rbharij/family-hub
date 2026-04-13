"use client"

import { useEffect, useRef } from "react"

interface ProgressRingProps {
  /** 0–100 */
  pct: number
  size?: number
  strokeWidth?: number
  color?: string
  trackColor?: string
  /** Label rendered in the centre */
  children?: React.ReactNode
}

export function ProgressRing({
  pct,
  size = 160,
  strokeWidth = 12,
  color = "#22c55e",
  trackColor,
  children,
}: ProgressRingProps) {
  const circleRef = useRef<SVGCircleElement>(null)

  const r = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference - (pct / 100) * circumference

  // Animate from 0 on mount
  useEffect(() => {
    const el = circleRef.current
    if (!el) return
    el.style.strokeDashoffset = String(circumference)
    requestAnimationFrame(() => {
      el.style.transition = "stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)"
      el.style.strokeDashoffset = String(offset)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct])

  const resolvedTrack = trackColor ?? "currentColor"

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={resolvedTrack}
          strokeWidth={strokeWidth}
          className="opacity-10"
        />
        {/* Progress */}
        <circle
          ref={circleRef}
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference} // starts at 0, animated in useEffect
        />
      </svg>
      {/* Centre content */}
      {children && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {children}
        </div>
      )}
    </div>
  )
}
