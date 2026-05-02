export interface Recipe {
  id: string
  title: string
  url: string | null
  notes: string | null
  tags: string[]
  created_at: string
}

export const PRESET_TAGS = [
  "Chicken", "Beef", "Pork", "Fish", "Vegetarian",
  "Pasta", "Soup", "Salad", "Dessert", "Quick", "Baking",
]

export const RECIPE_TABLES = [{ table: "recipes" }] as const
