"use client"

import { cn } from "@/lib/utils"

export interface FamilyMember {
  id: string
  name: string
  avatar_emoji: string | null
  color: string | null
}

interface MemberSelectorProps {
  members: FamilyMember[]
  selected: string[]           // member IDs
  onChange: (ids: string[]) => void
  label?: string
  required?: boolean
  showError?: boolean
}

export function MemberSelector({
  members,
  selected,
  onChange,
  label = "Who ate this?",
  required = false,
  showError = false,
}: MemberSelectorProps) {
  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id))
    } else {
      onChange([...selected, id])
    }
  }

  if (members.length === 0) return null

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-0.5"> *</span>}
      </p>
      <div className="flex flex-wrap gap-2">
        {members.map((m) => {
          const isSelected = selected.includes(m.id)
          const color = m.color ?? "#6366f1"
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => toggle(m.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium border-2 transition-all select-none",
                isSelected
                  ? "border-current"
                  : "border-border bg-background text-muted-foreground hover:border-primary/40",
              )}
              style={
                isSelected
                  ? { color, borderColor: color, backgroundColor: `${color}18` }
                  : undefined
              }
            >
              {m.avatar_emoji && (
                <span className="text-base leading-none">{m.avatar_emoji}</span>
              )}
              {m.name}
            </button>
          )
        })}
      </div>
      {required && showError && selected.length === 0 && (
        <p className="text-xs text-destructive">Select at least one person</p>
      )}
    </div>
  )
}
