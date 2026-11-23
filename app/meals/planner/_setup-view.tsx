"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { MemberAvatar } from "@/components/member-avatar"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase"
import { LUNCH_KIND_LABELS, type LunchKind, type PlannerSettings } from "@/lib/meal-planner"
import { DAY_LABELS, DAY_FULL } from "../_utils"

interface ProfileMember {
  id: string
  name: string
  avatar_emoji: string | null
  avatar_url?: string | null
  color: string | null
  is_child: boolean
  food_likes: string | null
  food_dislikes: string | null
  dietary_needs: string | null
}

const SELECT_CLASS = "flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const LUNCH_KINDS: LunchKind[] = ["hot", "cold", "school", "none"]

export function SetupView() {
  const supabase = useRef(createClient()).current
  const [members, setMembers]   = useState<ProfileMember[]>([])
  const [settings, setSettings] = useState<PlannerSettings | null>(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [missing, setMissing]   = useState(false)

  const fetchAll = useCallback(async () => {
    const [memRes, setRes] = await Promise.all([
      supabase.from("family_members").select("*").order("created_at"),
      supabase.from("meal_planner_settings").select("*").limit(1).maybeSingle(),
    ])
    setMembers((memRes.data ?? []) as ProfileMember[])
    if (setRes.error || !setRes.data) setMissing(true)
    else setSettings(setRes.data as PlannerSettings)
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchAll() }, [fetchAll])

  function patch(p: Partial<PlannerSettings>) {
    setSettings((s) => (s ? { ...s, ...p } : s))
  }

  function toggleDay(field: "car_dinner_days" | "lunch_days", day: number) {
    if (!settings) return
    const cur = settings[field] ?? []
    patch({ [field]: cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day].sort() } as Partial<PlannerSettings>)
  }

  function updateMember(id: string, p: Partial<ProfileMember>) {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...p } : m)))
  }

  async function saveAll() {
    if (!settings) return
    setSaving(true)
    try {
      const { id, ...rest } = settings
      const { error } = await supabase.from("meal_planner_settings").update({
        lunch_pattern: rest.lunch_pattern,
        car_dinner_days: rest.car_dinner_days,
        car_dinner_member_id: rest.car_dinner_member_id,
        lunch_days: rest.lunch_days,
        favourite_slots: rest.favourite_slots.filter((f) => f.title.trim()),
        household_notes: rest.household_notes?.trim() || null,
        auto_draft: rest.auto_draft,
      }).eq("id", id)
      if (error) throw error

      for (const m of members) {
        const { error: mErr } = await supabase.from("family_members").update({
          food_likes: m.food_likes?.trim() || null,
          food_dislikes: m.food_dislikes?.trim() || null,
          dietary_needs: m.dietary_needs?.trim() || null,
        }).eq("id", m.id)
        if (mErr) throw mErr
      }
      toast.success("Planner setup saved")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Skeleton className="h-96 rounded-[24px]" />

  if (missing || !settings) {
    return (
      <div className="rounded-[24px] bg-card border border-border p-6 max-w-xl">
        <h2 className="font-display text-[20px] font-semibold">Planner tables not found</h2>
        <p className="text-muted-foreground mt-1">
          Apply the migration <code>20261123000000_meal_planner.sql</code> to Supabase, then reload this page.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 pb-24">
      {/* ── Food profiles ────────────────────────────────────────────────── */}
      <Section title="Food profiles" hint="The planner never suggests a dislike and always respects dietary needs.">
        <div className="grid gap-3 md:grid-cols-2">
          {members.map((m) => (
            <div key={m.id} className="rounded-2xl border border-border bg-background/70 p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2.5">
                <MemberAvatar member={m} className="size-9 text-[16px]" />
                <p className="font-semibold text-[16px]">{m.name}</p>
                {m.is_child && <span className="text-[12px] text-muted-foreground">child</span>}
              </div>
              <Field label="Likes">
                <Textarea rows={2} value={m.food_likes ?? ""} onChange={(e) => updateMember(m.id, { food_likes: e.target.value })} placeholder="e.g. pasta, Japanese food, roast chicken" />
              </Field>
              <Field label="Dislikes">
                <Textarea rows={2} value={m.food_dislikes ?? ""} onChange={(e) => updateMember(m.id, { food_dislikes: e.target.value })} placeholder="e.g. mushrooms, spicy food, fish" />
              </Field>
              <Field label="Dietary needs">
                <Input value={m.dietary_needs ?? ""} onChange={(e) => updateMember(m.id, { dietary_needs: e.target.value })} placeholder="e.g. no pork, nut free" />
              </Field>
            </div>
          ))}
        </div>
      </Section>

      {/* ── School lunches ───────────────────────────────────────────────── */}
      <Section title="School lunchboxes" hint="The same pattern every week, for all the kids. Hot days get leftovers from the night before in a food flask.">
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
          {[0, 1, 2, 3, 4].map((d) => (
            <Field key={d} label={DAY_FULL[d]}>
              <select
                className={SELECT_CLASS}
                value={settings.lunch_pattern?.[String(d)] ?? "none"}
                onChange={(e) => patch({ lunch_pattern: { ...settings.lunch_pattern, [String(d)]: e.target.value as LunchKind } })}
              >
                {LUNCH_KINDS.map((k) => <option key={k} value={k}>{LUNCH_KIND_LABELS[k]}</option>)}
              </select>
            </Field>
          ))}
        </div>
      </Section>

      {/* ── Car dinners ──────────────────────────────────────────────────── */}
      <Section title="Car dinners" hint="Portable dinners for late evening classes, added on these days every week.">
        <div className="grid gap-4 sm:grid-cols-[240px_1fr] items-end">
          <Field label="Who for">
            <select
              className={SELECT_CLASS}
              value={settings.car_dinner_member_id ?? ""}
              onChange={(e) => patch({ car_dinner_member_id: e.target.value || null })}
            >
              <option value="">Nobody</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <DayChips selected={settings.car_dinner_days ?? []} onToggle={(d) => toggleDay("car_dinner_days", d)} />
        </div>
      </Section>

      {/* ── Home lunches ─────────────────────────────────────────────────── */}
      <Section title="Home lunches" hint="Days when the planner should suggest a lunch at home.">
        <DayChips selected={settings.lunch_days ?? []} onToggle={(d) => toggleDay("lunch_days", d)} />
      </Section>

      {/* ── Favourites ───────────────────────────────────────────────────── */}
      <Section title="Fixed favourites" hint="Dinners that stay on the same day every week, e.g. pizza on Friday.">
        <div className="flex flex-col gap-2">
          {settings.favourite_slots.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                className={cn(SELECT_CLASS, "w-36")}
                value={f.day}
                onChange={(e) => patch({ favourite_slots: settings.favourite_slots.map((x, j) => (j === i ? { ...x, day: Number(e.target.value) } : x)) })}
              >
                {DAY_FULL.map((name, d) => <option key={d} value={d}>{name}</option>)}
              </select>
              <Input
                value={f.title}
                onChange={(e) => patch({ favourite_slots: settings.favourite_slots.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
                placeholder="e.g. Homemade pizza"
              />
              <Button variant="ghost" size="icon-sm" aria-label="Remove favourite" onClick={() => patch({ favourite_slots: settings.favourite_slots.filter((_, j) => j !== i) })}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="outline" className="self-start rounded-xl gap-2" onClick={() => patch({ favourite_slots: [...settings.favourite_slots, { day: 4, title: "" }] })}>
            <Plus className="size-4" /> Add favourite
          </Button>
        </div>
      </Section>

      {/* ── Household notes ──────────────────────────────────────────────── */}
      <Section title="Household notes" hint="Anything else the planner should know: kitchen kit, store-cupboard staples you always have, cuisines to try, budget.">
        <Textarea
          rows={3}
          value={settings.household_notes ?? ""}
          onChange={(e) => patch({ household_notes: e.target.value })}
          placeholder="e.g. We have a slow cooker and an air fryer. Always stocked: rice, pasta, tinned tomatoes, soy sauce."
        />
      </Section>

      {/* ── Auto draft ───────────────────────────────────────────────────── */}
      <Section title="Weekly draft">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Draft next week automatically</p>
            <p className="text-xs text-muted-foreground mt-0.5">Every Saturday at 7am, ready for you to review and confirm.</p>
          </div>
          <Switch checked={settings.auto_draft} onCheckedChange={(v) => patch({ auto_draft: Boolean(v) })} />
        </div>
      </Section>

      <div className="fixed bottom-4 right-4 lg:bottom-6 lg:right-8 z-20">
        <Button className="h-12 px-6 rounded-xl shadow-lg text-[15px]" onClick={saveAll} disabled={saving}>
          {saving ? "Saving…" : "Save setup"}
        </Button>
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[24px] bg-card border border-border p-5 flex flex-col gap-3">
      <div>
        <h2 className="font-display text-[20px] font-semibold">{title}</h2>
        {hint && <p className="text-[13.5px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[13px]">{label}</Label>
      {children}
    </div>
  )
}

function DayChips({ selected, onToggle }: { selected: number[]; onToggle: (d: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {DAY_LABELS.map((label, d) => (
        <button
          key={d}
          type="button"
          aria-pressed={selected.includes(d)}
          onClick={() => onToggle(d)}
          className={cn(
            "h-10 min-w-[52px] rounded-xl px-3 text-[14px] font-semibold border transition-colors",
            selected.includes(d) ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-secondary",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
