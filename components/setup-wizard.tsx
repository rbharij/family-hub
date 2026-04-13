"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Check, Loader2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase"
import { useAppSettings } from "@/lib/app-settings-context"

// ── Constants ─────────────────────────────────────────────────────────────────

const EMOJIS = [
  "👩","👨","👧","👦","👶","👴","👵","🧑","🧒",
  "👩‍🍳","👨‍🍳","👩‍💼","👨‍💼","👩‍🎨","👨‍🎨","👩‍🏫","👨‍🏫",
  "🦸‍♀️","🦸‍♂️","🧙‍♀️","🧙‍♂️",
  "🐶","🐱","🐻","🦊","🐼","🐨","🦁","🐸",
  "🌟","⭐","🌈","🌸","🍀","🎈","🎯","🏆",
]

const COLORS = [
  "#ef4444","#f97316","#eab308","#22c55e",
  "#14b8a6","#3b82f6","#8b5cf6","#ec4899",
  "#f59e0b","#06b6d4","#84cc16","#6366f1",
]

// ── Types ─────────────────────────────────────────────────────────────────────

interface WizardMember {
  tempId: string
  dbId?: string       // set when loaded from DB
  name: string
  avatar_emoji: string
  color: string
  is_child: boolean
}

type Step = "name" | "members"

// ── Main component ────────────────────────────────────────────────────────────

export function SetupWizard() {
  const { settings, loading, updateSettings } = useAppSettings()
  const [step, setStep]       = useState<Step>("name")
  const [familyName, setFamilyName] = useState("Family Hub")
  const [members, setMembers] = useState<WizardMember[]>([])
  const [saving, setSaving]   = useState(false)
  const supabase = useRef(createClient()).current

  // Load existing members so the wizard pre-populates them
  useEffect(() => {
    if (loading || !settings || settings.setupComplete) return
    setFamilyName(settings.familyName)
    supabase
      .from("family_members")
      .select("id, name, avatar_emoji, color, is_child")
      .order("created_at")
      .then(({ data }) => {
        if (data && data.length > 0) {
          setMembers(data.map((m, i) => ({
            tempId: m.id,
            dbId: m.id,
            name: m.name,
            avatar_emoji: m.avatar_emoji ?? EMOJIS[i % EMOJIS.length],
            color: m.color ?? COLORS[i % COLORS.length],
            is_child: m.is_child ?? false,
          })))
        } else {
          // No existing members — start with one blank row
          setMembers([{
            tempId: "new-1",
            name: "",
            avatar_emoji: "👩",
            color: COLORS[0],
            is_child: false,
          }])
        }
      })
  }, [loading, settings, supabase])

  const addMember = useCallback(() => {
    setMembers((prev) => [
      ...prev,
      {
        tempId: `new-${Date.now()}`,
        name: "",
        avatar_emoji: EMOJIS[prev.length % EMOJIS.length],
        color: COLORS[prev.length % COLORS.length],
        is_child: false,
      },
    ])
  }, [])

  const removeMember = useCallback((tempId: string) => {
    setMembers((prev) => prev.filter((m) => m.tempId !== tempId))
  }, [])

  const patchMember = useCallback((tempId: string, patch: Partial<WizardMember>) => {
    setMembers((prev) => prev.map((m) => m.tempId === tempId ? { ...m, ...patch } : m))
  }, [])

  async function handleComplete() {
    setSaving(true)
    try {
      const valid = members.filter((m) => m.name.trim())

      // Delete all existing members (replace the seeded defaults)
      const existingIds = members.filter((m) => m.dbId).map((m) => m.dbId!)
      if (existingIds.length > 0) {
        await supabase.from("family_members").delete().in("id", existingIds)
      }

      // Insert wizard members
      if (valid.length > 0) {
        await supabase.from("family_members").insert(
          valid.map((m) => ({
            name: m.name.trim(),
            avatar_emoji: m.avatar_emoji,
            color: m.color,
            is_child: m.is_child,
          })),
        )
      }

      await updateSettings({
        familyName: familyName.trim() || "Family Hub",
        setupComplete: true,
      })
      // wizard unmounts when setupComplete = true
    } finally {
      setSaving(false)
    }
  }

  // Don't render until we know setup is needed
  if (loading || !settings || settings.setupComplete) return null

  const validCount = members.filter((m) => m.name.trim()).length

  return (
    <div className="fixed inset-0 z-[200] bg-background flex flex-col items-center justify-center p-4 overflow-y-auto">

      {/* Step dots */}
      <div className="flex gap-2 mb-10">
        {(["name", "members"] as Step[]).map((s) => (
          <div
            key={s}
            className={cn(
              "h-2 rounded-full transition-all duration-300",
              step === s ? "w-8 bg-primary" : "w-2 bg-muted-foreground/30",
            )}
          />
        ))}
      </div>

      <div className="w-full max-w-md">

        {/* ── Step 1: Family name ───────────────────────────────────────────── */}
        {step === "name" && (
          <div className="space-y-8 text-center">
            <div className="text-7xl select-none">🏠</div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Welcome to Family Hub</h1>
              <p className="text-muted-foreground mt-2">
                Let&apos;s get your family set up in a few quick steps.
              </p>
            </div>

            <div className="text-left space-y-2">
              <Label htmlFor="wizard-family-name">Family name</Label>
              <Input
                id="wizard-family-name"
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && familyName.trim() && setStep("members")}
                placeholder="The Smith Family"
                className="h-12 text-base"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Shown in the app header, e.g. &ldquo;The Smith Family Hub&rdquo;
              </p>
            </div>

            <Button
              size="lg"
              className="w-full gap-2"
              onClick={() => setStep("members")}
              disabled={!familyName.trim()}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* ── Step 2: Family members ────────────────────────────────────────── */}
        {step === "members" && (
          <div className="space-y-5">
            <div className="text-center">
              <div className="text-6xl select-none mb-3">👨‍👩‍👧‍👦</div>
              <h2 className="text-2xl font-bold tracking-tight">Your family</h2>
              <p className="text-muted-foreground text-sm mt-1">
                Add each person who uses Family Hub
              </p>
            </div>

            <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
              {members.map((member, idx) => (
                <MemberCard
                  key={member.tempId}
                  member={member}
                  index={idx}
                  onChange={(patch) => patchMember(member.tempId, patch)}
                  onRemove={() => removeMember(member.tempId)}
                  canRemove={members.length > 1}
                />
              ))}
            </div>

            <Button variant="outline" className="w-full gap-2" onClick={addMember}>
              <Plus className="h-4 w-4" /> Add family member
            </Button>

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={() => setStep("name")}
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={handleComplete}
                disabled={saving || validCount === 0}
              >
                {saving
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Check className="h-4 w-4" />}
                {saving ? "Saving…" : "Done!"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Member card sub-component ─────────────────────────────────────────────────

function MemberCard({
  member,
  index,
  onChange,
  onRemove,
  canRemove,
}: {
  member: WizardMember
  index: number
  onChange: (patch: Partial<WizardMember>) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const [showEmoji, setShowEmoji] = useState(false)

  return (
    <div className="border rounded-xl p-4 space-y-3 bg-muted/20">
      {/* Name + remove */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowEmoji((v) => !v)}
          className="text-2xl leading-none w-9 h-9 flex items-center justify-center rounded-lg border hover:bg-muted transition-colors shrink-0"
          title="Choose emoji"
        >
          {member.avatar_emoji}
        </button>
        <Input
          value={member.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={`Person ${index + 1}`}
          className="flex-1 h-9"
          autoFocus={index === 0 && !member.name}
        />
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
            title="Remove"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Emoji picker */}
      {showEmoji && (
        <div className="flex flex-wrap gap-1.5">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => { onChange({ avatar_emoji: e }); setShowEmoji(false) }}
              className={cn(
                "text-xl leading-none w-9 h-9 flex items-center justify-center rounded-lg border transition-colors",
                member.avatar_emoji === e
                  ? "border-primary bg-primary/10"
                  : "border-transparent hover:bg-muted",
              )}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {/* Colour + is_child */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1.5 flex-wrap flex-1">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ color: c })}
              className={cn(
                "w-6 h-6 rounded-full border-2 transition-transform hover:scale-110",
                member.color === c ? "border-foreground scale-110" : "border-transparent",
              )}
              style={{ backgroundColor: c }}
              title={c}
            />
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={member.is_child}
            onChange={(e) => onChange({ is_child: e.target.checked })}
            className="rounded"
          />
          Child
        </label>
      </div>
    </div>
  )
}
