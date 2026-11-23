import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  addDaysStr, weekDates, weekdayIndex, daysBetween, buildShoppingList, shoppingItemLabel,
  SCHOOL_LUNCH_TITLE, FREEZER_OLD_DAYS, DEFAULT_VEG_DINNERS, DEFAULT_MAX_SAME_PROTEIN, PROTEINS,
  linkDinnerFlags, dependentsOf, EATING_OUT_TITLE,
  type WeekPlan, type PlanDay, type PlannedMeal, type PlannedLunchbox, type PlannerSettings, type RecipeDetail,
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
  const skipped = ctx.existingPlan?.plan.days.find((d) => d.date === date)?.skipped ?? []
  for (const slot of skipped) {
    lines.push(`  NOT NEEDED ${slot}${slot === "dinner" || slot === "lunch" ? " (eating out)" : ""}: set it to null, and do not plan leftovers from it`)
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
- If the freezer has anything in it, use it: put freezer meals on WEEKDAYS (Monday to Friday), ideally the busiest evenings. Never put a freezer meal on Saturday or Sunday.
- Use freezer items marked OLD first. Never use more portions than are in the freezer.

Lunchboxes and car dinners come from dinner wherever possible (one lunchbox, the same for all the children):
- A lunchbox is ideally made from the PREVIOUS evening's dinner: plain leftovers (source "leftovers") or a slight variation, e.g. roast chicken becomes chicken pasta salad (source "variation", list only the extra ingredients). Set based_on "previous_day".
- HOT days: the previous dinner should reheat well in a food flask; set extra_for_lunchbox=true on that dinner.
- COLD days: use leftovers that are good cold, or a cold variation; set extra_for_lunchbox=true on that dinner. Only if the previous dinner really does not suit, suggest a simple cold lunchbox with ingredients and set based_on null.
- Monday relies on last Sunday's dinner, which is outside this plan; use it only if it is given.
- School-provided days and days with no lunchbox: set lunchbox to null.
- Car dinners (only on days that need one) are ideally a portion or a portable twist on that day's dinner (based_on "same_day", set extra_for_car_dinner=true on the dinner) or on the previous day's dinner (based_on "previous_day"), e.g. curry becomes a curry wrap. Portable, easy to eat with hands or one fork in a moving car, not messy.
- Choose dinners with this in mind: on days before a HOT lunchbox, favour dishes that keep and reheat well.

Home lunches: only on days that need one; otherwise null.

Variety and preferences:
- Respect every dislike and dietary need. Lean towards stated likes.
- Do not repeat any dinner from the recent list, and no repeats within the week apart from leftovers.
- Balance the week: meet the vegetarian target given below, vary the meats (chicken, beef, pork, lamb, fish, seafood), never the same meat two nights running, and no meat more often than the maximum given. Mix cuisines too.
- Set protein on every meal (its main protein; "vegetarian" for meat-free, "mixed" only when there is genuinely no main one).
- Fixed favourite dinners go on their day as given (source "favourite").
- Keep LOCKED meals exactly as they are.
- Any meal is allowed; the family's saved recipes are listed in case they fit.

Ingredients: for each meal cooked from scratch, list ingredients with realistic quantities for this household (metric). Leave out basic store-cupboard items (salt, pepper, cooking oil, common dried spices) and anything the household notes say is always stocked. No ingredients for freezer, batch or leftover meals.

Choices: for every dinner that is not LOCKED or a fixed favourite, also give 2 alternatives in "alternatives" that suit the same day just as well (title, short note, source, cook_minutes, effort, protein; no ingredients). Make the three clearly different from each other, e.g. a different protein or cuisine, while keeping the week balanced.

Keep notes short (under 15 words). Return the plan with the submit_week_plan tool.`

function describeBalance(ctx: PlannerContext): string {
  const veg = ctx.settings.veg_dinners_per_week ?? DEFAULT_VEG_DINNERS
  const max = ctx.settings.max_same_protein ?? DEFAULT_MAX_SAME_PROTEIN
  return [
    `At least ${veg} vegetarian dinner${veg === 1 ? "" : "s"} this week.`,
    `No single meat more than ${max} time${max === 1 ? "" : "s"} this week, and never the same meat two nights running.`,
    ctx.freezer.length ? "The freezer has meals in it: use at least one on a weekday." : "",
  ].filter(Boolean).join("\n")
}

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
  parts.push("## Balance targets", describeBalance(ctx))
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
  source:             { type: "string", enum: ["fresh", "cook_morning", "freezer", "batch", "leftovers", "variation", "favourite"] },
  protein:            { type: "string", enum: ["chicken", "beef", "pork", "lamb", "fish", "seafood", "vegetarian", "vegan", "eggs", "mixed"] },
  based_on:           { type: ["string", "null"], enum: ["same_day", "previous_day", null] },
  cook_minutes:       { type: "integer" },
  effort:             { type: "string", enum: ["easy", "medium", "ambitious"] },
  ingredients:        INGREDIENTS_SCHEMA,
  freezer_item_id:    { type: "string" },
  freezer_portions:   { type: "integer" },
  extra_for_lunchbox: { type: "boolean" },
  extra_for_car_dinner: { type: "boolean" },
  freeze_portions:    { type: "integer" },
}

const MEAL_SCHEMA = { type: ["object", "null"], properties: MEAL_PROPS, required: ["title", "source", "protein"] }

/** Light alternative: enough to choose from; full details are filled in when chosen */
const ALT_SCHEMA = {
  type: "object",
  properties: {
    title:        { type: "string" },
    notes:        { type: "string" },
    source:       MEAL_PROPS.source,
    cook_minutes: { type: "integer" },
    effort:       MEAL_PROPS.effort,
    protein:      MEAL_PROPS.protein,
  },
  required: ["title", "source", "protein"],
}

const DINNER_SCHEMA = {
  type: ["object", "null"],
  properties: { ...MEAL_PROPS, alternatives: { type: "array", items: ALT_SCHEMA, maxItems: 2 } },
  required: ["title", "source", "protein", "alternatives"],
}

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
            dinner:     DINNER_SCHEMA,
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

const OPTIONS_TOOL = {
  name: "submit_options",
  description: "Submit three different meal options for one slot.",
  input_schema: {
    type: "object",
    properties: {
      options: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: { type: "object", properties: MEAL_PROPS, required: ["title", "source", "ingredients"] },
      },
    },
    required: ["options"],
  },
}

const COMPLETE_TOOL = {
  name: "submit_meal",
  description: "Submit the full details of the chosen meal.",
  input_schema: { type: "object", properties: MEAL_PROPS, required: ["title", "source"] },
}

// ── Claude call ───────────────────────────────────────────────────────────────

async function callClaude<T>(
  user: string,
  tool: { name: string; description: string; input_schema: object },
  maxTokens: number,
  system: string = SYSTEM_PROMPT,
): Promise<T> {
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
      system,
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
    extra_for_car_dinner: Boolean(raw.extra_for_car_dinner),
    protein: raw.protein && PROTEINS.includes(raw.protein) ? raw.protein : null,
    based_on: raw.based_on === "same_day" || raw.based_on === "previous_day" ? raw.based_on : null,
    freeze_portions: raw.freeze_portions && raw.freeze_portions > 0 ? raw.freeze_portions : null,
  }
  if (raw.alternatives?.length) {
    meal.alternatives = raw.alternatives
      .map((a) => cleanAlternative(a, ctx))
      .filter((a): a is PlannedMeal => a !== null && a.title.toLowerCase() !== meal.title.toLowerCase())
      .slice(0, 5)
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

/** An alternative without ingredients is marked incomplete; details are filled in when it is chosen. */
function cleanAlternative(raw: PlannedMeal, ctx: PlannerContext): PlannedMeal | null {
  const alt = cleanMeal({ ...raw, alternatives: undefined }, ctx)
  if (!alt) return null
  const needsIngredients = alt.source === "fresh" || alt.source === "cook_morning" || alt.source === "favourite"
  alt.incomplete = needsIngredients && !(alt.ingredients?.length)
  return alt
}

function normaliseDay(raw: Partial<PlanDay> | undefined, date: string, ctx: PlannerContext, locked: LockedMap): PlanDay {
  const prev = ctx.existingPlan?.plan.days.find((d) => d.date === date)
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
  // Cleared slots stay cleared through replans
  if (prev?.skipped?.length) {
    day.skipped = [...prev.skipped]
    day.skipped_meals = prev.skipped_meals
    for (const slot of prev.skipped) day[slot] = null
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

  const plan: WeekPlan = linkDinnerFlags({ summary: raw.summary?.trim() || null, days, batch_session: batch })

  const { data, error } = await supabase
    .from("meal_plans")
    .upsert({ week_start: weekStart, plan, status: "draft", source: opts.source }, { onConflict: "week_start" })
    .select("*")
    .single()
  if (error) throw new Error(`Could not save the plan: ${error.message}`)
  return data as MealPlanRow
}

function planSummaryLines(plan: WeekPlan): string {
  return plan.days.map((d) => {
    const bits = (["dinner", "lunch", "lunchbox", "car_dinner"] as SlotKey[])
      .map((s) => d[s] ? `${s}: ${d[s]!.title}${s === "dinner" && d[s]!.protein ? ` [${d[s]!.protein}]` : ""}` : null).filter(Boolean)
    return `${DAY_NAMES[weekdayIndex(d.date)]} ${d.date}: ${bits.join("; ")}`
  }).join("\n")
}

async function savePlan(supabase: SupabaseClient, planId: string, plan: WeekPlan): Promise<MealPlanRow> {
  const { data, error } = await supabase
    .from("meal_plans")
    .update({ plan: linkDinnerFlags(plan) })
    .eq("id", planId)
    .select("*")
    .single()
  if (error) throw new Error(`Could not save the plan: ${error.message}`)
  return data as MealPlanRow
}

// ── Keeping lunchboxes and car dinners in step with dinner ────────────────────

const SYNC_TOOL = {
  name: "submit_updates",
  description: "Submit the updated lunchbox and car dinner meals.",
  input_schema: {
    type: "object",
    properties: {
      lunchbox_next_day:   MEAL_SCHEMA,
      car_dinner_same_day: MEAL_SCHEMA,
      car_dinner_next_day: MEAL_SCHEMA,
    },
  },
}

/**
 * After a dinner changes, rewrite the lunchbox / car dinner made from it so
 * they stay in step. Returns the updated plan and a list of what changed.
 */
async function syncDependents(
  ctx: PlannerContext, plan: WeekPlan, dinnerDate: string, mode: "changed" | "skipped" | "restored" = "changed",
  /** For "skipped": the plan before the dinner was cleared, to find what relied on it */
  before?: WeekPlan,
): Promise<{ plan: WeekPlan; changed: string[] }> {
  const deps   = mode === "restored" ? candidatesFor(plan, dinnerDate) : dependentsOf(linkDinnerFlags(before ?? plan), dinnerDate)
  const dinner = plan.days.find((d) => d.date === dinnerDate)?.dinner
  if (!deps.length || (!dinner && mode !== "skipped")) return { plan, changed: [] }

  const next = addDaysStr(dinnerDate, 1)
  const wanted = deps.map((d) =>
    d.slot === "lunchbox" ? `lunchbox_next_day: the ${lunchKindFor(ctx, d.date).toUpperCase()} lunchbox on ${DAY_NAMES[weekdayIndex(d.date)]} ${d.date}`
    : d.date === dinnerDate ? `car_dinner_same_day: the car dinner on ${DAY_NAMES[weekdayIndex(d.date)]} ${d.date}`
    : `car_dinner_next_day: the car dinner on ${DAY_NAMES[weekdayIndex(d.date)]} ${d.date}`)

  const extra = mode === "skipped" ? [
    `The current plan for the week is:\n${planSummaryLines(plan)}`,
    `The family is eating out on ${DAY_NAMES[weekdayIndex(dinnerDate)]} ${dinnerDate}, so there is no home-cooked dinner that evening and no leftovers from it.`,
    `Rewrite only these so they no longer rely on that dinner:\n- ${wanted.join("\n- ")}`,
    "Suggest simple standalone meals with ingredients and set based_on null. Hot lunchboxes must reheat well in a food flask, cold ones must be good cold, car dinners must be portable.",
    "Return them with the submit_updates tool.",
  ].join("\n") : [
    `The current plan for the week is:\n${planSummaryLines(plan)}`,
    `The dinner on ${DAY_NAMES[weekdayIndex(dinnerDate)]} ${dinnerDate} has changed to "${dinner!.title}"${dinner!.notes ? ` (${dinner!.notes})` : ""}.`,
    `Rewrite only these so they stay in step with the new dinner:\n- ${wanted.join("\n- ")}`,
    "Make each one from the new dinner where it suits: plain leftovers (source \"leftovers\") or a slight variation (source \"variation\", list only the extra ingredients).",
    `Set based_on to "previous_day" for the lunchbox and for a car dinner on ${next}, and "same_day" for a car dinner on ${dinnerDate}.`,
    "Hot lunchboxes must reheat well in a food flask, cold ones must be good cold, car dinners must be portable. If the new dinner really does not suit, suggest a simple alternative with ingredients and set based_on null.",
    "Return them with the submit_updates tool.",
  ].join("\n")

  const user = buildUserPrompt(ctx, collectLocked(ctx, false), extra)
  const raw  = await callClaude<{ lunchbox_next_day?: PlannedMeal | null; car_dinner_same_day?: PlannedMeal | null; car_dinner_next_day?: PlannedMeal | null }>(
    user, SYNC_TOOL, 2500,
  )

  const changed: string[] = []
  const days = plan.days.map((d) => ({ ...d }))
  for (const dep of deps) {
    const key = dep.slot === "lunchbox" ? "lunchbox_next_day" : dep.date === dinnerDate ? "car_dinner_same_day" : "car_dinner_next_day"
    const meal = cleanMeal(raw[key] ?? null, ctx)
    if (!meal) continue
    if (mode === "skipped") meal.based_on = null
    const day = days.find((x) => x.date === dep.date)!
    if (dep.slot === "lunchbox") {
      const kind = lunchKindFor(ctx, dep.date)
      day.lunchbox = { ...meal, kind: kind === "hot" || kind === "cold" ? kind : (day.lunchbox?.kind ?? "cold") }
    } else {
      day.car_dinner = meal
    }
    changed.push(`${DAY_NAMES[weekdayIndex(dep.date)].slice(0, 3)} ${dep.slot === "lunchbox" ? "lunchbox" : "car dinner"}`)
  }
  return { plan: linkDinnerFlags({ ...plan, days }), changed }
}

/** Called after a dinner is typed in by hand, so its lunchbox / car dinner follow. */
export async function syncAfterDinnerChange(
  supabase: SupabaseClient, weekStart: string, dinnerDate: string,
): Promise<{ row: MealPlanRow; changed: string[] }> {
  const ctx = await loadContext(supabase, weekStart)
  if (!ctx.existingPlan) throw new Error("There is no plan for this week yet")
  const { plan, changed } = await syncDependents(ctx, ctx.existingPlan.plan, dinnerDate)
  const row = await savePlan(supabase, ctx.existingPlan.id, plan)
  return { row, changed }
}

/** After a dinner is put back: the lunchbox / car dinners that could be made from it again. */
function candidatesFor(plan: WeekPlan, dinnerDate: string): { date: string; slot: "lunchbox" | "car_dinner" }[] {
  const next  = addDaysStr(dinnerDate, 1)
  const today = plan.days.find((d) => d.date === dinnerDate)
  const tomo  = plan.days.find((d) => d.date === next)
  const out: { date: string; slot: "lunchbox" | "car_dinner" }[] = []
  const lb = tomo?.lunchbox
  if (lb && !lb.locked && (lb.kind === "hot" || lb.kind === "cold") && !lb.based_on) out.push({ date: next, slot: "lunchbox" })
  if (today?.car_dinner && !today.car_dinner.locked && !today.car_dinner.based_on) out.push({ date: dinnerDate, slot: "car_dinner" })
  return out
}

/**
 * Clears a meal (e.g. eating out) or puts it back. Linked lunchboxes and
 * car dinners are rewritten so they do not rely on a dinner that is not cooked.
 */
export async function setSkipped(
  supabase: SupabaseClient, weekStart: string, date: string, slot: SlotKey, skip: boolean,
): Promise<{ row: MealPlanRow; changed: string[] }> {
  const ctx = await loadContext(supabase, weekStart)
  if (!ctx.existingPlan) throw new Error("There is no plan for this week yet")
  const plan = ctx.existingPlan.plan
  const day  = plan.days.find((d) => d.date === date)
  if (!day) throw new Error("That day is not in this plan")

  const skipped = new Set(day.skipped ?? [])
  const saved   = { ...(day.skipped_meals ?? {}) }
  let nextDay: PlanDay
  if (skip) {
    if (day[slot]) saved[slot] = day[slot]!
    skipped.add(slot)
    nextDay = { ...day, [slot]: null, skipped: Array.from(skipped), skipped_meals: saved }
  } else {
    skipped.delete(slot)
    const back = saved[slot] ?? null
    delete saved[slot]
    nextDay = {
      ...day,
      [slot]: slot === "lunchbox" && back ? { ...(back as PlannedLunchbox), kind: (back as PlannedLunchbox).kind ?? lunchKindFor(ctx, date) } : back,
      skipped: Array.from(skipped),
      skipped_meals: saved,
    }
  }

  let updated: WeekPlan = { ...plan, days: plan.days.map((d) => (d.date === date ? nextDay : d)) }
  let changed: string[] = []
  if (slot === "dinner") {
    const synced = await syncDependents(ctx, updated, date, skip ? "skipped" : "restored", plan)
    updated = synced.plan
    changed = synced.changed
  }
  const row = await savePlan(supabase, ctx.existingPlan.id, updated)
  return { row, changed }
}

async function savePlanDay(
  supabase: SupabaseClient, planId: string, plan: WeekPlan, date: string, slot: SlotKey, meal: PlannedMeal, kind?: LunchKind,
): Promise<MealPlanRow> {
  const days = plan.days.map((d) => {
    if (d.date !== date) return d
    if (slot === "lunchbox") return { ...d, lunchbox: { ...meal, kind: kind ?? d.lunchbox?.kind ?? "cold" } }
    return { ...d, [slot]: meal }
  })
  return savePlan(supabase, planId, { ...plan, days })
}

/**
 * Three fresh options for one slot. They are stored as the meal's
 * alternatives (with ingredients, so choosing one is instant).
 */
export async function optionsFor(
  supabase: SupabaseClient,
  weekStart: string,
  date: string,
  slot: SlotKey,
  hint?: string,
): Promise<MealPlanRow> {
  const ctx = await loadContext(supabase, weekStart)
  if (!ctx.existingPlan) throw new Error("There is no plan for this week yet")
  const plan    = ctx.existingPlan.plan
  const day     = plan.days.find((d) => d.date === date)
  const current = day?.[slot]
  if (!day || !current) throw new Error("That meal is not in the plan")

  const avoid = [current.title, ...(current.alternatives ?? []).map((a) => a.title)]
  const extra = [
    `The current plan for the week is:\n${planSummaryLines(plan)}`,
    `Give 3 different options for the ${slot.replace("_", " ")} on ${DAY_NAMES[weekdayIndex(date)]} ${date}.`,
    `Do not suggest any of these: ${avoid.join(", ")}. Make the three clearly different from each other and from the rest of the week.`,
    "Each option must suit that day's time available and follow all the household rules, including the balance targets (count the other dinners above). Set protein on each. Include ingredients for each.",
    slot === "dinner" ? "Where the next day has a lunchbox or car dinner made from this dinner, favour options that leave good leftovers for it." : "",
    slot === "lunchbox" || slot === "car_dinner" ? "Where it suits, make the options from the dinner they follow (leftovers or a slight variation) and set based_on." : "",
    slot === "lunchbox" ? `This is a ${lunchKindFor(ctx, date).toUpperCase()} lunchbox day.` : "",
    hint ? `The family asked for: ${hint}` : "",
    "Return them with the submit_options tool.",
  ].filter(Boolean).join("\n")

  const user = buildUserPrompt(ctx, collectLocked(ctx, false), extra)
  const raw  = await callClaude<{ options?: PlannedMeal[] }>(user, OPTIONS_TOOL, 4000)
  const options = (raw.options ?? [])
    .map((o) => cleanMeal({ ...o, alternatives: undefined }, ctx))
    .filter((o): o is PlannedMeal => o !== null)
  if (!options.length) throw new Error("Claude did not return any options")

  const { alternatives: _old, ...rest } = current
  void _old
  return savePlanDay(supabase, ctx.existingPlan.id, plan, date, slot, { ...rest, alternatives: options })
}

/**
 * Makes one of the alternatives the chosen meal. The previous choice moves
 * into the alternatives, so the family can switch back.
 */
export async function chooseOption(
  supabase: SupabaseClient,
  weekStart: string,
  date: string,
  slot: SlotKey,
  index: number,
): Promise<{ row: MealPlanRow; changed: string[] }> {
  const ctx = await loadContext(supabase, weekStart)
  if (!ctx.existingPlan) throw new Error("There is no plan for this week yet")
  const plan    = ctx.existingPlan.plan
  const day     = plan.days.find((d) => d.date === date)
  const current = day?.[slot]
  const alts    = current?.alternatives ?? []
  const picked  = alts[index]
  if (!day || !current || !picked) throw new Error("That option is no longer available")

  let chosen: PlannedMeal = picked
  if (picked.incomplete) {
    const extra = [
      `The current plan for the week is:\n${planSummaryLines(plan)}`,
      `The family chose "${picked.title}" for the ${slot.replace("_", " ")} on ${DAY_NAMES[weekdayIndex(date)]} ${date}${picked.notes ? ` (${picked.notes})` : ""}.`,
      "Return exactly this meal, keeping the same title, with full details and ingredients, using the submit_meal tool.",
    ].join("\n")
    const user = buildUserPrompt(ctx, collectLocked(ctx, false), extra)
    const raw  = await callClaude<PlannedMeal>(user, COMPLETE_TOOL, 2000)
    const full = cleanMeal({ ...raw, title: picked.title, alternatives: undefined }, ctx)
    if (!full) throw new Error("Claude did not return the meal")
    chosen = full
  }

  // Keep the previous choice's recipe so switching back is instant
  const { alternatives: _a, ...previous } = current
  void _a
  const others = alts.filter((_, i) => i !== index)
  const next: PlannedMeal = {
    ...chosen,
    incomplete: false,
    locked: current.locked,
    alternatives: [{ ...previous, incomplete: false }, ...others],
  }

  const days = plan.days.map((d) => {
    if (d.date !== date) return d
    if (slot === "lunchbox") return { ...d, lunchbox: { ...next, kind: d.lunchbox?.kind ?? "cold" } }
    return { ...d, [slot]: next }
  })
  let updated: WeekPlan = { ...plan, days }
  let changed: string[] = []
  if (slot === "dinner") {
    const synced = await syncDependents(ctx, updated, date)
    updated = synced.plan
    changed = synced.changed
  }
  const row = await savePlan(supabase, ctx.existingPlan.id, updated)
  return { row, changed }
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
    if (m.extra_for_car_dinner) bits.push("Make an extra portion for the car dinner")
    if (m.source === "leftovers") bits.push("Leftovers")
    if (m.source === "variation") bits.push("Twist on dinner")
    if (m.freeze_portions) bits.push(`Cook double, freeze ${m.freeze_portions}`)
    if (m.notes) bits.push(m.notes)
    return bits.length ? bits.join(". ") : null
  }

  const deletes: { date: string; meal_type: string }[] = []
  for (const day of plan.days) {
    for (const slot of day.skipped ?? []) {
      if (slot === "dinner" || slot === "lunch") {
        writes.push({ date: day.date, meal_type: slot, title: EATING_OUT_TITLE, notes: null, for_member_id: null, freezer_item_id: null })
      } else {
        deletes.push({ date: day.date, meal_type: slot })
      }
    }
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

  // Cleared lunchboxes / car dinners: remove any rows from an earlier confirm
  for (const d of deletes) {
    const { error: delErr } = await supabase.from("meals").delete().eq("date", d.date).eq("meal_type", d.meal_type)
    if (delErr) throw new Error(`Could not clear ${d.meal_type} on ${d.date}: ${delErr.message}`)
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

// ── Recipe detail (written on demand, cached in the plan) ─────────────────────

const RECIPE_SYSTEM = `You write clear home recipes for a family. Write in UK English with metric quantities.
Keep the main ingredients and quantities the planner already chose, and add the store-cupboard items (oil, salt, spices and so on) so the list is complete.
Steps are short, practical and in order, with timings where they help (for example "Simmer for 20 minutes"). 4-10 steps.
If the meal comes from the freezer, a batch cook or leftovers, give reheating and serving steps instead of a full recipe, plus how long to defrost.
If it is a car dinner, include how to pack it so it is easy to eat in the car. If it is a hot lunchbox, include how to heat the food flask.
effort_note is one sentence on what makes it quick or demanding (hands-on time, tricky steps, washing up).
Return it with the submit_recipe tool.`

const RECIPE_TOOL = {
  name: "submit_recipe",
  description: "Submit the full recipe.",
  input_schema: {
    type: "object",
    properties: {
      serves:       { type: "integer" },
      prep_minutes: { type: "integer" },
      cook_minutes: { type: "integer" },
      effort:       { type: "string", enum: ["easy", "medium", "ambitious"] },
      effort_note:  { type: "string" },
      ingredients:  INGREDIENTS_SCHEMA,
      steps:        { type: "array", items: { type: "string" } },
      tips:         { type: "array", items: { type: "string" } },
    },
    required: ["serves", "ingredients", "steps"],
  },
}

export async function getRecipe(
  supabase: SupabaseClient,
  weekStart: string,
  date: string,
  slot: SlotKey,
  refresh = false,
): Promise<RecipeDetail> {
  const { data: row, error } = await supabase.from("meal_plans").select("*").eq("week_start", weekStart).single()
  if (error || !row) throw new Error("There is no plan for this week")
  const plan = (row as MealPlanRow).plan
  const day  = plan.days.find((d) => d.date === date)
  const meal = day?.[slot]
  if (!day || !meal) throw new Error("That meal is not in the plan")
  if (meal.recipe && !refresh) return meal.recipe

  const { data: members } = await supabase.from("family_members").select("name, is_child, food_dislikes, dietary_needs")
  const people = (members ?? []) as { name: string; is_child: boolean; food_dislikes: string | null; dietary_needs: string | null }[]
  const { data: settings } = await supabase.from("meal_planner_settings").select("household_notes").limit(1).maybeSingle()

  const serves =
    slot === "car_dinner" ? 1
    : slot === "lunchbox" ? Math.max(1, people.filter((p) => p.is_child).length)
    : (meal.freezer_portions ?? people.length) || 4
  const extraServes = slot === "dinner"
    ? (meal.extra_for_lunchbox ? people.filter((p) => p.is_child).length : 0) + (meal.extra_for_car_dinner ? 1 : 0)
    : 0

  const lines = [
    `Meal: ${meal.title}`,
    `Slot: ${slot.replace("_", " ")}${slot === "lunchbox" && day.lunchbox ? ` (${day.lunchbox.kind})` : ""} on ${DAY_NAMES[weekdayIndex(date)]}`,
    `Source: ${meal.source ?? "fresh"}`,
    `Serves: ${serves}${extraServes ? `, plus ${extraServes} extra portion${extraServes === 1 ? "" : "s"} for lunchboxes or the car dinner` : ""}${meal.freeze_portions ? `, plus ${meal.freeze_portions} portions to freeze (cook double)` : ""}`,
    meal.cook_minutes ? `Planned time: about ${meal.cook_minutes} minutes, ${meal.effort ?? "easy"}` : "",
    meal.notes ? `Planner notes: ${meal.notes}` : "",
    meal.ingredients?.length ? `Ingredients already chosen: ${meal.ingredients.map((i) => (i.qty ? `${i.name} ${i.qty}` : i.name)).join("; ")}` : "",
    `Dislikes to avoid: ${people.map((p) => p.food_dislikes ? `${p.name}: ${p.food_dislikes}` : null).filter(Boolean).join("; ") || "none"}`,
    `Dietary needs: ${people.map((p) => p.dietary_needs ? `${p.name}: ${p.dietary_needs}` : null).filter(Boolean).join("; ") || "none"}`,
    (settings as { household_notes?: string | null } | null)?.household_notes ? `Household notes: ${(settings as { household_notes: string }).household_notes}` : "",
  ].filter(Boolean).join("\n")

  const raw = await callClaude<Partial<RecipeDetail>>(lines, RECIPE_TOOL, 3000, RECIPE_SYSTEM)
  const recipe: RecipeDetail = {
    serves: raw.serves ?? serves,
    prep_minutes: raw.prep_minutes ?? null,
    cook_minutes: raw.cook_minutes ?? meal.cook_minutes ?? null,
    effort: raw.effort ?? meal.effort ?? null,
    effort_note: raw.effort_note?.trim() || null,
    ingredients: (raw.ingredients ?? []).filter((i) => i?.name?.trim()),
    steps: (raw.steps ?? []).filter((s) => s?.trim()),
    tips: (raw.tips ?? []).filter((t) => t?.trim()),
  }
  if (!recipe.steps.length) throw new Error("Claude did not return any steps")

  // Re-read just before writing so edits made meanwhile are not lost
  const { data: fresh } = await supabase.from("meal_plans").select("id, plan").eq("week_start", weekStart).single()
  const freshPlan = (fresh as { id: string; plan: WeekPlan } | null)?.plan
  if (fresh && freshPlan) {
    const days = freshPlan.days.map((d) => {
      if (d.date !== date || !d[slot] || d[slot]!.title !== meal.title) return d
      return { ...d, [slot]: { ...d[slot]!, recipe } } as PlanDay
    })
    await supabase.from("meal_plans").update({ plan: { ...freshPlan, days } }).eq("id", (fresh as { id: string }).id)
  }
  return recipe
}
