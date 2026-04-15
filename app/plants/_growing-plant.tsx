"use client"

// ── Growing Plant SVG component ───────────────────────────────────────────────
// Four growth stages driven by `count`:
//   Stage 1 (0–9):   seedling
//   Stage 2 (10–19): growing plant with leaves, sway animation
//   Stage 3 (20–29): full plant with flower buds, sway animation
//   Stage 4 (30+):   blooming flowers + twinkling sparkles

interface GrowingPlantProps {
  count: number
  /** 'sm' → 90×115 (wall display)  'lg' → 150×190 (plants page) */
  size?: "sm" | "lg"
  className?: string
}

function getStage(count: number): 1 | 2 | 3 | 4 {
  if (count >= 30) return 4
  if (count >= 20) return 3
  if (count >= 10) return 2
  return 1
}

// ── Shared SVG pieces (all coordinates for viewBox 0 0 120 160) ───────────────

const SOIL = (
  <ellipse cx="60" cy="153" rx="22" ry="5.5" fill="#a16207" opacity="0.25" />
)

// Left leaf from stem at (60, y) — points left-and-up
function leftLeaf(y: number, fillColor = "#4ade80") {
  return (
    <path
      d={`M 60 ${y} C 52 ${y - 4} 32 ${y - 12} 26 ${y - 18}
          C 32 ${y - 25} 52 ${y - 20} 60 ${y} Z`}
      fill={fillColor}
      stroke="#15803d"
      strokeWidth="1.2"
    />
  )
}

// Right leaf from stem at (60, y) — mirror
function rightLeaf(y: number, fillColor = "#4ade80") {
  return (
    <path
      d={`M 60 ${y} C 68 ${y - 4} 88 ${y - 12} 94 ${y - 18}
          C 88 ${y - 25} 68 ${y - 20} 60 ${y} Z`}
      fill={fillColor}
      stroke="#15803d"
      strokeWidth="1.2"
    />
  )
}

// ── Stage SVGs ────────────────────────────────────────────────────────────────

function SeedlingSVG() {
  return (
    <>
      {SOIL}
      {/* Short stem */}
      <path d="M 60 152 Q 59 132 60 108" stroke="#16a34a" strokeWidth="2.8" fill="none" strokeLinecap="round" />
      {leftLeaf(120)}
      {rightLeaf(120)}
    </>
  )
}

function GrowingSVG() {
  return (
    <>
      {SOIL}
      {/* Taller stem */}
      <path d="M 60 152 Q 57 108 60 58" stroke="#16a34a" strokeWidth="2.8" fill="none" strokeLinecap="round" />
      {leftLeaf(138)}
      {rightLeaf(124)}
      {leftLeaf(104)}
      {rightLeaf(82)}
    </>
  )
}

function BudsSVG() {
  return (
    <>
      {SOIL}
      {/* Tall stem */}
      <path d="M 60 152 Q 57 98 60 32" stroke="#16a34a" strokeWidth="2.8" fill="none" strokeLinecap="round" />
      {leftLeaf(140)}
      {rightLeaf(124)}
      {leftLeaf(104)}
      {rightLeaf(84)}
      {leftLeaf(65)}
      {rightLeaf(50)}
      {/* Left bud branch */}
      <path d="M 57 44 Q 46 30 38 20" stroke="#16a34a" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* Right bud branch */}
      <path d="M 63 36 Q 74 22 82 12" stroke="#16a34a" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* Left bud */}
      <ellipse cx="37" cy="16" rx="5.5" ry="8" fill="#d97706" stroke="#92400e" strokeWidth="1.2" />
      <ellipse cx="37" cy="13" rx="3" ry="4" fill="#fbbf24" opacity="0.6" />
      {/* Right bud */}
      <ellipse cx="83" cy="9" rx="5.5" ry="8" fill="#d97706" stroke="#92400e" strokeWidth="1.2" />
      <ellipse cx="83" cy="6" rx="3" ry="4" fill="#fbbf24" opacity="0.6" />
    </>
  )
}

function BloomSVG() {
  // Helper: open flower at (cx, cy) with petal radius r
  function flower(cx: number, cy: number, r: number) {
    const offsets = [
      [0, -r * 1.6],
      [r * 1.4, -r * 0.8],
      [r * 1.4, r * 0.8],
      [0, r * 1.6],
      [-r * 1.4, r * 0.8],
      [-r * 1.4, -r * 0.8],
    ]
    return (
      <>
        {offsets.map(([dx, dy], i) => (
          <circle key={i} cx={cx + dx} cy={cy + dy} r={r} fill="#fde68a" stroke="#f59e0b" strokeWidth="0.8" />
        ))}
        <circle cx={cx} cy={cy} r={r * 1.1} fill="#f59e0b" />
      </>
    )
  }

  return (
    <>
      {SOIL}
      {/* Tall stem */}
      <path d="M 60 152 Q 57 98 60 32" stroke="#16a34a" strokeWidth="2.8" fill="none" strokeLinecap="round" />
      {leftLeaf(140, "#86efac")}
      {rightLeaf(124, "#86efac")}
      {leftLeaf(104, "#4ade80")}
      {rightLeaf(84, "#4ade80")}
      {leftLeaf(65, "#4ade80")}
      {rightLeaf(50, "#4ade80")}
      {/* Left flower branch */}
      <path d="M 57 44 Q 46 30 38 20" stroke="#16a34a" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* Right flower branch */}
      <path d="M 63 36 Q 74 22 82 12" stroke="#16a34a" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* Flowers */}
      {flower(38, 16, 5)}
      {flower(83, 9, 5)}
      {/* Sparkle dots (animated via CSS class) */}
      <circle cx="14" cy="40" r="2.5" fill="#fbbf24" className="plant-sparkle-1" />
      <circle cx="106" cy="30" r="2"   fill="#fbbf24" className="plant-sparkle-2" />
      <circle cx="18"  cy="70" r="1.8" fill="#a3e635" className="plant-sparkle-3" />
      <circle cx="102" cy="58" r="2"   fill="#fbbf24" className="plant-sparkle-1" />
      <circle cx="10"  cy="100" r="1.5" fill="#fde68a" className="plant-sparkle-2" />
    </>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function GrowingPlant({ count, size = "sm", className = "" }: GrowingPlantProps) {
  const stage = getStage(count)
  const [w, h] = size === "lg" ? [150, 190] : [90, 114]
  const sway = stage >= 2

  return (
    <>
      {/* Scoped keyframe styles */}
      <style>{`
        @keyframes plantSway {
          0%, 100% { transform: rotate(-1.8deg); }
          50%       { transform: rotate(1.8deg); }
        }
        @keyframes plantSparkle {
          0%, 100% { opacity: 0.1; r: 1.5; }
          50%       { opacity: 1;   r: 3; }
        }
        .plant-sway {
          animation: plantSway 3s ease-in-out infinite;
          transform-box: fill-box;
          transform-origin: bottom center;
        }
        .plant-sparkle-1 { animation: plantSparkle 1.4s ease-in-out infinite; }
        .plant-sparkle-2 { animation: plantSparkle 1.4s ease-in-out infinite 0.45s; }
        .plant-sparkle-3 { animation: plantSparkle 1.4s ease-in-out infinite 0.9s; }
        @keyframes plantFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .plant-fade-in { animation: plantFadeIn 0.8s ease; }
      `}</style>

      <div
        key={stage}
        className={`plant-fade-in inline-block ${className}`}
        style={{ width: w, height: h }}
      >
        <svg
          viewBox="0 0 120 160"
          width={w}
          height={h}
          overflow="visible"
          aria-hidden
        >
          <g className={sway ? "plant-sway" : undefined}>
            {stage === 1 && <SeedlingSVG />}
            {stage === 2 && <GrowingSVG />}
            {stage === 3 && <BudsSVG />}
            {stage === 4 && <BloomSVG />}
          </g>
        </svg>
      </div>
    </>
  )
}
