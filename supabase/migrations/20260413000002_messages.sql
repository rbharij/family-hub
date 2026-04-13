-- Family messages table
CREATE TABLE public.messages (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_member_id uuid        REFERENCES public.family_members(id) ON DELETE SET NULL,
  to_member_id   uuid        NOT NULL REFERENCES public.family_members(id) ON DELETE CASCADE,
  body           text        NOT NULL CHECK (char_length(body) <= 280),
  created_at     timestamptz NOT NULL DEFAULT now(),
  dismissed_at   timestamptz
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow all on messages"
  ON public.messages FOR ALL USING (true) WITH CHECK (true);

-- Fast lookup of undismissed messages per recipient
CREATE INDEX idx_messages_to_dismissed
  ON public.messages (to_member_id, dismissed_at);

CREATE INDEX idx_messages_created
  ON public.messages (created_at DESC);
