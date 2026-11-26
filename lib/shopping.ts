import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Adds items to the Groceries list (or the first list if there is no
 * Groceries list), skipping anything already on it and not yet ticked off.
 * Only called when the family asks for it.
 */
export async function addToGroceries(
  supabase: SupabaseClient,
  names: string[],
): Promise<{ added: number; skipped: number; listName: string | null }> {
  const { data: lists } = await supabase.from("shopping_lists").select("id, name").order("created_at")
  const rows = (lists ?? []) as { id: string; name: string }[]
  const list = rows.find((l) => l.name.toLowerCase().includes("grocer")) ?? rows[0]
  if (!list) throw new Error("There is no shopping list to add to")

  const { data: items } = await supabase.from("shopping_items").select("name").eq("list_id", list.id).eq("completed", false)
  const have = new Set(((items ?? []) as { name: string }[]).map((i) => i.name.trim().toLowerCase()))

  const seen = new Set<string>()
  const toAdd: { list_id: string; name: string; quantity: number }[] = []
  for (const raw of names) {
    const name = raw.trim()
    const key  = name.toLowerCase()
    if (!name || have.has(key) || seen.has(key)) continue
    seen.add(key)
    toAdd.push({ list_id: list.id, name, quantity: 1 })
  }
  if (toAdd.length) {
    const { error } = await supabase.from("shopping_items").insert(toAdd)
    if (error) throw new Error(`Could not add to the shopping list: ${error.message}`)
  }
  return { added: toAdd.length, skipped: names.length - toAdd.length, listName: list.name }
}
