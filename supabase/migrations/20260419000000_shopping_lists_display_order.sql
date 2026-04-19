-- Add display_order to shopping_lists and backfill existing rows

alter table public.shopping_lists
  add column if not exists display_order int;

-- Backfill: assign sequential order based on original created_at
with ordered as (
  select id, row_number() over (order by created_at) as rn
  from public.shopping_lists
)
update public.shopping_lists
set display_order = ordered.rn
from ordered
where shopping_lists.id = ordered.id;

-- Enforce NOT NULL now that all rows have a value
alter table public.shopping_lists
  alter column display_order set not null;
