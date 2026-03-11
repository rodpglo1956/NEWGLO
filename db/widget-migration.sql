-- Glo Matrix Widget Migration
-- Adds bot_messages table (separate from existing messages table)
-- Run in Supabase SQL Editor

-- ============================================================
-- BOT MESSAGES (web chat + widget conversations)
-- ============================================================
CREATE TABLE IF NOT EXISTS bot_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  bot_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  channel TEXT DEFAULT 'widget' CHECK (channel IN ('web', 'widget', 'telegram')),
  session_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_bot_messages_bot_id ON bot_messages(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_messages_session ON bot_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_bot_messages_created ON bot_messages(created_at DESC);

ALTER TABLE bot_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all_bot_messages" ON bot_messages FOR ALL USING (true);
