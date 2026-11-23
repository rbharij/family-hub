import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  addDaysStr, weekDates, weekdayIndex, daysBetween, buildShoppingList, shoppingItemLabel,
  SCHOOL_LUNCH_TITLE, FREEZER_OLD_DAYS,
  type WeekPlan, type PlanDay, type PlannedMeal, type PlannedLunchbox, type PlannerSettings,
  type FreezerItem, type MealPlanRow, type SlotKey, type LunchKind,
} from "@/lib/meal-planner"

// ── Config ────────────────────────────────────────────────────────────────────

const FAMILY_TZ = () => process.env.FAMILY_TIMEZONE ?? "Asia/Singapore"
const MODEL     = () => process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5"

export function getServerSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

/** Today's date (YYYY-MM-DD) in the family's timezone. */
export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FAMILY_TZ(), year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date())
}

export function mondayOf(dateStr: string): string {
  return addDaysStr(dateStr, -weekdayIndex(dateStr))
}

// ── Context ───────────────────────────────────────────────────────────────────

interface Member {
  id: string
  name: string
  is_child: boolean
  food_likes: string | null
  food_dislikes: string | null
  dietary_needs: string | null
}

interface DayEvent { title: string; time: string; allDay: boolean }

interface ExistingMeal {
  id: string
  date: string
  meal_type: string
  title: string
  notes: string | null
  for_member_id: string | null
  freezer_item_id: string | null
}

export interface PlannerContext {
  weekStart: string
  dates: string[]
  location: string
  members: Member[]
  children: Member[]
  settings: PlannerSettings
  freezer: FreezerItem[]
  recipes: { title: string; tags: string[] }[]
  eventsByDate: Map<string, DayEvent[]>
  recentDinners: string[]
  existingMeals: ExistingMeal[]
  previousSundayDinner: string | null
  existingPlan: MealPlanRow | null
}

function localParts(iso: string) {
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: FAMILY_TZ(), year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d)
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: FAMILY_TZ(), hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d)
  return { date, time }
}

export async function loadContext(supabase: SupabaseClient, weekStart: string): Promise<PlannerContext> {
  const dates   = weekDates(weekStart)
  const weekEnd = dates[6]

  const [memRes, setRes, appRes, frzRes, recRes, evRes, recentRes, weekRes, planRes] = await Promise.all([
    supabase.from("family_members")
      .select("id, name, is_child, food_likes, food_dislikes, dietary_needs")
      .order("created_at"),
    supabase.from("meal_planner_settings").select("*").limit(1).maybeSingle(),
    supabase.from("app_settings").select("weather_location").limit(1).maybeSingle(),
    supabase.from("freezer_items").select("*").gt("portions", 0).order("frozen_on"),
    supabase.from("recipes").select("title, tags").order("title"),
    supabase.from("events").select("title, start_at, end_at, is_all_day")
      .gte("start_at", `${addDaysStr(weekStart, -7)}T00:00:00Z`)
      .lte("start_at", `${addDaysStr(weekEnd, 1)}T23:59:59Z`)
      .order("start_at"),
    supabase.from("meals").select("title, date")
      .eq("meal_type", "dinner")
      .gte("date", addDaysStr(weekStart, -21))
      .lt("date", weekStart),
    supabase.from("meals")
      .select("id, date, meal_type, title, notes, for_member_id, freezer_item_id")
      .gte("date", weekStart).lte("date", weekEnd),
    supabase.from("meal_plans").select("*").eq("week_start", weekStart).maybeSingle(),
  ])

  if (!setRes.data) throw new Error("Meal planner settings are missing. Has the migration been applied?")

  const members  = (memRes.data ?? []) as Member[]
  const settings = setRes.data as PlannerSettings

  // Events per local date (multi-day events appear on each day they cover)
  const eventsByDate = new Map<string, DayEvent[]>()
  for (const d of dates) eventsByDate.set(d, [])
  for (const ev of (evRes.data ?? []) as { title: string; start_at: string; end_at: string | null; is_all_day: boolean }[]) {
    if (ev.is_all_day) {
      const s = ev.start_at.slice(0, 10)
      const e = (ev.end_at ?? ev.start_at).slice(0, 10)
      for (const d of dates) if (d >= s && d <= e) eventsByDate.get(d)!.push({ title: ev.title, time: "all day", allDay: true })
      continue
    }
    const s = localParts(ev.start_at)
    const e = ev.end_at ? localParts(ev.end_at) : null
    for (const d of dates) {
      if (d < s.date || d > (e?.date ?? s.date)) continue
      const from = d === s.date ? s.time : "00:00"
      const to   = e ? (d === e.date ? e.time : "23:59") : null
      eventsByDate.get(d)!.push({ title: ev.title, time: to ? `${from}-${to}` : from, allDay: false })
    }
  }

  const recent = (recentRes.data ?? []) as { title: string; date: string }[]
  const previousSunday = addDaysStr(weekStart, -1)

  return {
    weekStart,
    dates,
    location: (appRes.data as { weather_location?: string } | null)?.weather_location ?? "Singapore",
    members,
    children: members.filter((m) => m.is_child),
    settings,
    freezer: (frzRes.data ?? []) as FreezerItem[],
    recipes: (recRes.data ?? []) as { title: string; tags: string[] }[],
    eventsByDate,
    recentDinners: Array.from(new Set(recent.map((r) => r.title))),
    existingMeals: (weekRes.data ?? []) as ExistingMeal[],
    previousSundayDinner: recent.find((r) => r.date === previousSunday)?.title ?? null,
    existingPlan: (planRes.data as MealPlanRow | null) ?? null,
  }
}

// ── Day rules derived from settings ───────────────────────────────────────────

function lunchKindFor(ctx: PlannerContext, date: string): LunchKind {
  const idx = weekdayIndex(date)
  if (idx > 4 || ctx.children.length === 0) return "none"
  return (ctx.settings.lunch_pattern?.[String(idx)] as LunchKind) ?? "none"
}

function needsCarDinner(ctx: PlannerContext, date: string): boolean {
  return (ctx.settings.car_dinner_days ?? []).includes(weekdayIndex(date))
}

function needsLunch(ctx: PlannerContext, date: string): boolean {
  return (ctx.settings.lunch_days ?? []).includes(weekdayIndex(date))
}

function favouriteFor(ctx: PlannerContext, date: string): string | null {
  return ctx.settings.favourite_slots?.find((f) => f.day === weekdayIndex(date))?.title ?? null
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

// ── Locked meals: from an existing plan, or meals already entered by hand ─────

type LockedMap = Map<string, PlannedMeal | PlannedLunchbox> // key: `${date}|${slot}`

function collectLocked(ctx: PlannerContext, keepLocked: boolean): LockedMap {
  const locked: LockedMap = new Map()

  if (keepLocked && ctx.existingPlan) {
    for (const day of ctx.existingPlan.plan.days) {
      for (const slot of ["dinner", "lunch", "lunchbox", "car_dinner"] as SlotKey[]) {
        const m = day[slot]
        if (m?.locked) locked.set(`${day.date}|${slot}`, m)
      }
    }
  }

  // Meals typed in by hand on the Meals page are treated as fixed
  // (only on a first draft, so regenerating a draft can replace AI meals).
  if (!ctx.existingPlan) {
    const firstChild = ctx.children[0]?.id
    for (const m of ctx.existingMeals) {
      if (m.meal_type === "lunchbox" && m.for_member_id !== firstChild) continue
      const key = `${m.date}|${m.meal_type}`
      if (locked.has(key)) continue
      if (m.meal_type === "lunchbox") {
        locked.set(key, {
          title: m.title, notes: m.notes, locked: true,
          kind: m.title === SCHOOL_LUNCH_TITLE ? "school" : lunchKindFor(ctx, m.date),
        })
      } else {
        locked.set(key, { title: m.title, notes: m.notes, locked: true })
      }
    }
  }
  return locked
}

// ── Prompt ────────────────────────────────────────────────────────────────────

function describeHousehold(ctx: PlannerContext): string {
  const carMember = ctx.members.find((m) => m.id === ctx.settings.car_dinner_member_id)
  const lines = ctx.members.map((m) => {
    const bits = [`- ${m.name}${m.is_child ? " (child)" : ""}`]
    if (m.food_likes)    bits.push(`likes: ${m.food_likes}`)
    if (m.food_dislikes) bits.push(`dislikes: ${m.food_dislikes}`)
    if (m.dietary_needs) bits.push(`dietary needs: ${m.dietary_needs}`)
    return bits.join("; ")
  })
  const out = [
    `Household of ${ctx.members.length}, living in ${ctx.location}. Use ingredients that are easy to buy in local supermarkets there.`,
    ...lines,
  ]
  if (carMember) out.push(`Car dinners are for ${carMember.name}, who eats in the car on the way back from a late evening class.`)
  if (ctx.settings.household_notes) out.push(`Household notes: ${ctx.settings.household_notes}`)
  return out.join("\n")
}

function describeFreezer(ctx: PlannerContext): string {
  if (ctx.freezer.length === 0) return "The freezer is empty."
  const today = todayLocal()
  return ctx.freezer.map((f) => {
    const age = daysBetween(f.frozen_on, today)
    const old = age >= FREEZER_OLD_DAYS ? " (OLD, use soon)" : ""
    return `- id=${f.id}: ${f.dish}, ${f.portions} portion${f.portions === 1 ? "" : "s"}, frozen ${f.frozen_on}${old}`
  }).join("\n")
}

function describeDay(ctx: PlannerContext, date: string, locked: LockedMap): string {
  const events = ctx.eventsByDate.get(date) ?? []
  const lines = [`${DAY_NAMES[weekdayIndex(date)]} ${date}`]
  lines.push(events.length
    ? `  Calendar: ${events.map((e) => `${e.time} ${e.title}`).join("; ")}`
    : "  Calendar: nothing scheduled")
  const fav = favouriteFor(ctx, date)
  if (fav) lines.push(`  Fixed favourite dinner: ${fav}`)
  lines.push(`  Home lunch needed: ${needsLunch(ctx, date) ? "yes" : "no"}`)
  const lk = lunchKindFor(ctx, date)
  lines.push(`  Lunchbox: ${lk === "hot" ? "HOT (sent in a food flask)" : lk === "cold" ? "COLD" : lk === "school" ? "school provides lunch, no prep" : "not needed"}`)
  lines.push(`  Car dinner needed: ${needsCarDinner(ctx, date) ? "yes" : "no"}`)
  for (const slot of ["dinner", "lunch", "lunchbox", "car_dinner"] as SlotKey[]) {
    const m = locked.get(`${date}|${slot}`)
    if (m) lines.push(`  LOCKED ${slot}: ${m.title} (keep exactly as is)`)
  }
  return lines.join("\n")
}

const SYSTEM_PROMPT = `You plan a family's meals for one week. Write in UK English.

How to work out time and effort each day:
- Read each day's calendar to judge who is busy and when. Events in the late afternoon or evening mean less time to cook dinner.
- If the evening is busy but the morning looks free, plan a dish that can be cooked in the morning and reheated, or a slow-cooker dish (source "cook_morning").
- If the whole day is packed, use a freezer portion (source "freezer", give freezer_item_id and freezer_portions) or a portion from this week's batch cook (source "batch").
- Quiet evenings can take longer or more ambitious recipes. Set cook_minutes and effort for every cooked meal.
- Give each day a short day_note (under 12 words) saying how much time there is and why, e.g. "Swimming 5-7pm, so cook in the morning".

Batch cooking and the freezer:
- If there is a quiet stretch of 2+ hours (often a weekend day) and the freezer is low or the week is busy, plan one batch_session with 1-3 dishes that freeze well. Give portions_to_freeze per dish. Later busy days may use those portions (source "batch").
- Otherwise set batch_session to null, and for 1-2 freezable dinners on calmer days set freeze_portions to suggest cooking double.
- Use freezer items marked OLD first. Never use more portions than are in the freezer.

Lunchboxes (one lunchbox, the same for all the children):
- HOT days: the previous evening's dinner should be something that reheats well in a food flask; set extra_for_lunchbox=true on that dinner and make the lunchbox "<dish> (leftovers, food flask)" with source "leftovers".
- COLD days: use leftovers that are good cold where the previous dinner suits it (source "leftovers"); otherwise suggest a simple cold lunchbox with ingredients.
- Monday relies on last Sunday's dinner, which is outside this plan; use it only if it is given.
- School-provided days and days with no lunchbox: set lunchbox to null.

Car dinners: only on days that need one. Portable, easy to eat with hands or one fork in a moving car, not messy, fine at room temperature or kept warm. It can be a portion of that day's dinner if the dinner is ready in time.

Home lunches: only on days that need one; otherwise null.

Variety and preferences:
- Respect every dislike and dietary need. Lean towards stated likes.
- Do not repeat any dinner from the recent list, and no repeats within the week apart from leftovers. Mix proteins and cuisines.
- Fixed favourite dinners go on their day as given (source "favourite").
- Keep LOCKED meals exactly as they are.
- Any meal is allowed; the family's saved recipes are listed in case they fit.

Ingredients: for each meal cooked from scratch, list ingredients with realistic quantities for this household (metric). Leave out basic store-cupboard items (salt, pepper, cooking oil, common dried spices) and anything the household notes say is always stocked. No ingredients for freezer, batch or leftover meals.

Keep notes short (under 15 words). Return the plan with the submit_week_plan tool.`

function buildUserPrompt(ctx: PlannerContext, locked: LockedMap, extra?: string): string {
  const parts = [
    "## Household", describeHousehold(ctx),
    "## Freezer", describeFreezer(ctx),
    "## Recent dinners (do not repeat)", ctx.recentDinners.length ? ctx.recentDinners.join(", ") : "none recorded",
  ]
  if (ctx.previousSundayDinner) parts.push("## Last Sunday's dinner", ctx.previousSundayDinner)
  if (ctx.recipes.length) {
    parts.push("## Saved family recipes", ctx.recipes.slice(0, 80).map((r) => r.tags.length ? `${r.title} [${r.tags.join(", ")}]` : r.title).join("; "))
  }
  parts.push("## The week", ctx.dates.map((d) => describeDay(ctx, d, locked)).join("\n\n"))
  if (extra) parts.push("## Extra instructions", extra)
  return parts.join("\n\n")
}

// ── Tool schemas ──────────────────────────────────────────────────────────────

const INGREDIENTS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: { name: { type: "string" }, qty: { type: "string" } },
    required: ["name"],
  },
}

const MEAL_PROPS = {
  title:              { type: "string" },
  notes:              { type: "string" },
  source:             { type: "string", enum: ["fresh", "cook_morning", "freezer", "batch", "leftovers", "favourite"] },
  cook_minutes:       { type: "integer" },
  effort:             { type: "string", enum: ["easy", "medium", "ambitious"] },
  ingredients:        INGREDIENTS_SCHEMA,
  freezer_item_id:    { type: "string" },
  freezer_portions:   { type: "integer" },
  extra_for_lunchbox: { type: "boolean" },
  freeze_portions:    { type: "integer" },
}

const MEAL_SCHEMA = { type: ["object", "null"], properties: MEAL_PROPS, required: ["title", "source"] }

const WEEK_TOOL = {
  name: "submit_week_plan",
  description: "Submit the full week's meal plan.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One or two sentences on the shape of the week." },
      days: {
        type: "array",
        minItems: 7,
        maxItems: 7,
        items: {
          type: "object",
          properties: {
            date:       { type: "string" },
            day_note:   { type: "string" },
            dinner:     MEAL_SCHEMA,
            lunch:      MEAL_SCHEMA,
            lunchbox:   MEAL_SCHEMA,
            car_dinner: MEAL_SCHEMA,
          },
          required: ["date", "day_note", "dinner", "lunch", "lunchbox", "car_dinner"],
        },
      },
      batch_session: {
        type: ["object", "null"],
        properties: {
          date:   { type: "string" },
          notes:  { type: "string" },
          dishes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                portions_to_freeze: { type: "integer" },
                ingredients: INGREDIENTS_SCHEMA,
              },
              required: ["title", "portions_to_freeze"],
            },
          },
        },
        required: ["date", "dishes"],
      },
    },
    required: ["summary", "days", "batch_session"],
  },
}

const SWAP_TOOL = {
  name: "submit_meal",
  description: "Submit the single replacement meal.",
  input_schema: { type: "object", properties: MEAL_PROPS, required: ["title", "source"] },
}

// ── Claude call ───────────────────────────────────────────────────────────────

async function callClaude<T>(user: string, tool: { name: string; description: string; input_schema: object }, maxTokens: number): Promise<T> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set")

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL(),
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: user }],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Claude request failed (${res.status}): ${body.slice(0, 300)}`)
  }

  const data = await res.json() as { content: { type: string; name?: string; input?: unknown }[] }
  const block = data.content.find((c) => c.type === "tool_use" && c.name === tool.name)
  if (!block?.input) throw new Error("Claude did not return a plan")
  return block.input as T
}

// ── Normalising the AI output against the household rules ─────────────────────

function cleanMeal(raw: PlannedMeal | null | undefined, ctx: PlannerContext): PlannedMeal | null {
  if (!raw || !raw.title?.trim()) return null
  const meal: PlannedMeal = {
    title: raw.title.trim(),
    notes: raw.notes?.trim() || null,
    source: raw.source ?? "fresh",
    cook_minutes: raw.cook_minutes ?? null,
    effort: raw.effort ?? null,
    ingredients: (raw.ingredients ?? []).filter((i) => i?.name?.trim()),
    extra_for_lunchbox: Boolean(raw.extra_for_lunchbox),
    freeze_portions: raw.freeze_portions && raw.freeze_portions > 0 ? raw.freeze_portions : null,
  }
  if (meal.source === "freezer") {
    let item = ctx.freezer.find((f) => f.id === raw.freezer_item_id)
    if (!item) item = ctx.freezer.find((f) => f.dish.toLowerCase() === meal.title.toLowerCase())
    if (item) {
      meal.freezer_item_id = item.id
      meal.freezer_portions = Math.min(item.portions, Math.max(1, raw.freezer_portions ?? ctx.members.length))
      meal.ingredients = []
    } else {
      meal.source = "fresh"
    }
  }
  return meal
}

function normaliseDay(raw: Partial<PlanDay> | undefined, date: string, ctx: PlannerContext, locked: LockedMap): PlanDay {
  const lk = lunchKindFor(ctx, date)

  let lunchbox: PlannedLunchbox | null = null
  if (lk === "school") {
    lunchbox = { title: SCHOOL_LUNCH_TITLE, kind: "school", source: "fresh", ingredients: [] }
  } else if (lk === "hot" || lk === "cold") {
    const m = cleanMeal(raw?.lunchbox ?? null, ctx)
    lunchbox = m ? { ...m, kind: lk } : null
  }

  const day: PlanDay = {
    date,
    day_note: raw?.day_note?.trim() || null,
    dinner: cleanMeal(raw?.dinner ?? null, ctx),
    lunch: needsLunch(ctx, date) ? cleanMeal(raw?.lunch ?? null, ctx) : null,
    lunchbox,
    car_dinner: needsCarDinner(ctx, date) ? cleanMeal(raw?.car_dinner ?? null, ctx) : null,
  }

  for (const slot of ["dinner", "lunch", "lunchbox", "car_dinner"] as SlotKey[]) {
    const m = locked.get(`${date}|${slot}`)
    if (!m) continue
    if (slot === "lunchbox") day.lunchbox = { ...(m as PlannedLunchbox), locked: true }
    else day[slot] = { ...m, locked: true }
  }
  return day
}

// ── Public: generate / swap / confirm ─────────────────────────────────────────

export async function generatePlan(
  supabase: SupabaseClient,
  weekStart: string,
  opts: { source: "manual" | "auto"; keepLocked: boolean; instructions?: string },
): Promise<MealPlanRow> {
  const ctx    = await loadContext(supabase, weekStart)
  const locked = collectLocked(ctx, opts.keepLocked)
  const user   = buildUserPrompt(ctx, locked, opts.instructions)

  const raw = await callClaude<{ summary?: string; days?: Partial<PlanDay>[]; batch_session?: WeekPlan["batch_session"] }>(
    user, WEEK_TOOL, 12000,
  )

  const byDate = new Map((raw.days ?? []).map((d) => [d.date, d]))
  const days   = ctx.dates.map((date, i) => normaliseDay(byDate.get(date) ?? raw.days?.[i], date, ctx, locked))

  let batch = raw.batch_session ?? null
  if (batch && (!batch.dishes?.length || !ctx.dates.includes(batch.date))) batch = null
  if (batch) {
    batch = {
      date: batch.date,
      notes: batch.notes?.trim() || null,
      dishes: batch.dishes
        .filter((d) => d.title?.trim())
        .map((d) => ({ title: d.title.trim(), portions_to_freeze: Math.max(0, d.portions_to_freeze ?? 0), ingredients: d.ingredients ?? [] })),
      done: false,
    }
  }

  const plan: WeekPlan = { summary: raw.summary?.trim() || null, days, batch_session: batch }

  const { data, error } = await supabase
    .from("meal_plans")
    .upsert({ week_start: weekStart, plan, status: "draft", source: opts.source }, { onConflict: "week_start" })
    .select("*")
    .single()
  if (error) throw new Error(`Could not save the plan: ${error.message}`)
  return data as MealPlanRow
}

export async function swapMeal(
  supabase: SupabaseClient,
  weekStart: string,
  date: string,
  slot: SlotKey,
  hint?: string,
): Promise<MealPlanRow> {
  const ctx = await loadContext(supabase, weekStart)
  if (!ctx.existingPlan) throw new Error("There is no plan for this week yet")

  const plan   = ctx.existingPlan.plan
  const dayIdx = plan.days.findIndex((d) => d.date === date)
  if (dayIdx < 0) throw new Error("That day is not in this plan")
  const current = plan.days[dayIdx][slot]

  const planLines = plan.days.map((d) => {
    const bits = (["dinner", "lunch", "lunchbox", "car_dinner"] as SlotKey[])
      .map((s) => d[s] ? `${s}: ${d[s]!.title}` : null).filter(Boolean)
    return `${DAY_NAMES[weekdayIndex(d.date)]} ${d.date}: ${bits.join("; ")}`
  }).join("\n")

  const extra = [
    `The current plan for the week is:\n${planLines}`,
    `Replace only the ${slot.replace("_", " ")} on ${DAY_NAMES[weekdayIndex(date)]} ${date}${current ? ` (currently "${current.title}")` : ""}.`,
    "Suggest something different from everything else in the week and from the current choice.",
    slot === "lunchbox" ? `This is a ${lunchKindFor(ctx, date).toUpperCase()} lunchbox day.` : "",
    hint ? `The family asked for: ${hint}` : "",
    "Return the single meal with the submit_meal tool.",
  ].filter(Boolean).join("\n")

  const locked = collectLocked(ctx, false)
  const user   = buildUserPrompt(ctx, locked, extra)
  const raw    = await callClaude<PlannedMeal>(user, SWAP_TOOL, 2000)
  const meal   = cleanMeal(raw, ctx)
  if (!meal) throw new Error("Claude did not return a meal")

  const day = { ...plan.days[dayIdx] }
  if (slot === "lunchbox") {
    const kind = lunchKindFor(ctx, date)
    day.lunchbox = kind === "hot" || kind === "cold" ? { ...meal, kind } : day.lunchbox
  } else {
    day[slot] = meal
  }
  const days = [...plan.days]
  days[dayIdx] = day

  const { data, error } = await supabase
    .from("meal_plans")
    .update({ plan: { ...plan, days } })
    .eq("id", ctx.existingPlan.id)
    .select("*")
    .single()
  if (error) throw new Error(`Could not save the plan: ${error.message}`)
  return data as MealPlanRow
}

/**
 * Writes the plan into the Meals page, takes freezer portions, and adds
 * missing ingredients to the Groceries shopping list.
 */
export async function confirmPlan(
  supabase: SupabaseClient,
  weekStart: string,
): Promise<{ meals: number; shopping: number; freezer: number }> {
  const { data: row, error } = await supabase.from("meal_plans").select("*").eq("week_start", weekStart).single()
  if (error || !row) throw new Error("There is no plan for this week")
  const planRow = row as MealPlanRow
  const plan    = planRow.plan

  const [{ data: kids }, { data: settings }] = await Promise.all([
    supabase.from("family_members").select("id").eq("is_child", true).order("created_at"),
    supabase.from("meal_planner_settings").select("car_dinner_member_id").limit(1).maybeSingle(),
  ])
  const childIds    = (kids ?? []).map((k: { id: string }) => k.id)
  const carMemberId = (settings as { car_dinner_member_id: string | null } | null)?.car_dinner_member_id ?? null

  // 1. Put back freezer portions from an earlier confirm of this same plan
  for (const d of planRow.freezer_deductions ?? []) {
    const { data: item } = await supabase.from("freezer_items").select("portions").eq("id", d.freezer_item_id).maybeSingle()
    if (item) await supabase.from("freezer_items").update({ portions: (item as { portions: number }).portions + d.portions }).eq("id", d.freezer_item_id)
  }

  // 2. Write meals (update existing slot rows so plant logs keep their meal ids)
  const { data: existing } = await supabase
    .from("meals")
    .select("id, date, meal_type, for_member_id")
    .gte("date", weekStart).lte("date", addDaysStr(weekStart, 6))
  const existingMap = new Map(
    ((existing ?? []) as { id: string; date: string; meal_type: string; for_member_id: string | null }[])
      .map((m) => [`${m.date}|${m.meal_type}|${m.for_member_id ?? ""}`, m.id]),
  )

  type MealWrite = { date: string; meal_type: string; title: string; notes: string | null; for_member_id: string | null; freezer_item_id: string | null }
  const writes: MealWrite[] = []
  const noteFor = (m: PlannedMeal) => {
    const bits: string[] = []
    if (m.source === "cook_morning") bits.push("Cook in the morning")
    if (m.source === "freezer") bits.push("From the freezer")
    if (m.source === "batch") bits.push("From batch cook")
    if (m.extra_for_lunchbox) bits.push("Make extra for lunchboxes")
    if (m.freeze_portions) bits.push(`Cook double, freeze ${m.freeze_portions}`)
    if (m.notes) bits.push(m.notes)
    return bits.length ? bits.join(". ") : null
  }

  for (const day of plan.days) {
    if (day.dinner) writes.push({ date: day.date, meal_type: "dinner", title: day.dinner.title, notes: noteFor(day.dinner), for_member_id: null, freezer_item_id: day.dinner.freezer_item_id ?? null })
    if (day.lunch)  writes.push({ date: day.date, meal_type: "lunch",  title: day.lunch.title,  notes: noteFor(day.lunch),  for_member_id: null, freezer_item_id: day.lunch.freezer_item_id ?? null })
    if (day.lunchbox && day.lunchbox.kind !== "none") {
      const lb = day.lunchbox
      const notes = lb.kind === "school" ? null : [lb.kind === "hot" ? "Hot, food flask" : "Cold", lb.notes].filter(Boolean).join(". ")
      for (const cid of childIds) {
        writes.push({ date: day.date, meal_type: "lunchbox", title: lb.title, notes, for_member_id: cid, freezer_item_id: lb.freezer_item_id ?? null })
      }
    }
    if (day.car_dinner) writes.push({ date: day.date, meal_type: "car_dinner", title: day.car_dinner.title, notes: noteFor(day.car_dinner), for_member_id: carMemberId, freezer_item_id: day.car_dinner.freezer_item_id ?? null })
  }

  for (const w of writes) {
    const id = existingMap.get(`${w.date}|${w.meal_type}|${w.for_member_id ?? ""}`)
    const res = id
      ? await supabase.from("meals").update(w).eq("id", id)
      : await supabase.from("meals").insert(w)
    if (res.error) throw new Error(`Could not save ${w.meal_type} on ${w.date}: ${res.error.message}`)
  }

  // 3. Take freezer portions
  const used = new Map<string, number>()
  for (const day of plan.days) {
    for (const slot of ["dinner", "lunch", "lunchbox", "car_dinner"] as SlotKey[]) {
      const m = day[slot]
      if (m?.source === "freezer" && m.freezer_item_id) {
        used.set(m.freezer_item_id, (used.get(m.freezer_item_id) ?? 0) + (m.freezer_portions ?? 1))
      }
    }
  }
  const deductions: { freezer_item_id: string; portions: number }[] = []
  for (const [id, portions] of Array.from(used.entries())) {
    const { data: item } = await supabase.from("freezer_items").select("portions").eq("id", id).maybeSingle()
    if (!item) continue
    const have = (item as { portions: number }).portions
    const take = Math.min(have, portions)
    await supabase.from("freezer_items").update({ portions: have - take }).eq("id", id)
    deductions.push({ freezer_item_id: id, portions: take })
  }

  // 4. Shopping list: add anything not already on the Groceries list
  const { data: lists } = await supabase.from("shopping_lists").select("id, name").order("created_at")
  const listRows = (lists ?? []) as { id: string; name: string }[]
  const groceries = listRows.find((l) => l.name.toLowerCase().includes("grocer")) ?? listRows[0]
  let added = 0
  if (groceries) {
    const { data: items } = await supabase.from("shopping_items").select("name").eq("list_id", groceries.id).eq("completed", false)
    const have = new Set(((items ?? []) as { name: string }[]).map((i) => i.name.trim().toLowerCase()))
    const toAdd = buildShoppingList(plan)
      .map(shoppingItemLabel)
      .filter((label) => !have.has(label.toLowerCase()))
      .map((name) => ({ list_id: groceries.id, name, quantity: 1 }))
    if (toAdd.length) {
      const { error: shopErr } = await supabase.from("shopping_items").insert(toAdd)
      if (shopErr) throw new Error(`Could not add to the shopping list: ${shopErr.message}`)
      added = toAdd.length
    }
  }

  // 5. Mark confirmed
  await supabase.from("meal_plans").update({
    status: "confirmed",
    confirmed_at: new Date().toISOString(),
    freezer_deductions: deductions,
  }).eq("id", planRow.id)

  return { meals: writes.length, shopping: added, freezer: deductions.reduce((s, d) => s + d.portions, 0) }
}
