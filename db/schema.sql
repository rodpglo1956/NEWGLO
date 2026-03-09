-- Ava Relay - Supabase Schema
-- Multi-agent ready (bot_id on all tables)
-- Run in Supabase SQL Editor

CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  channel TEXT DEFAULT 'telegram',
  bot_id TEXT DEFAULT 'ava',
  metadata JSONB DEFAULT '{}',
  embedding VECTOR(1536)
);

CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_bot_id ON messages(bot_id);

-- ============================================================
-- MEMORY (Facts & Goals)
-- ============================================================
CREATE TABLE IF NOT EXISTS memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  type TEXT NOT NULL CHECK (type IN ('fact', 'goal', 'completed_goal', 'preference')),
  content TEXT NOT NULL,
  deadline TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  priority INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  embedding VECTOR(1536)
);

CREATE INDEX IF NOT EXISTS idx_memory_type ON memory(type);

-- ============================================================
-- BOT ACTIVITY LOG (Steve monitors this)
-- ============================================================
CREATE TABLE IF NOT EXISTS bot_activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  bot_id TEXT NOT NULL,
  event TEXT NOT NULL,
  details TEXT DEFAULT '',
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_activity_bot ON bot_activity_log(bot_id);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON bot_activity_log(created_at DESC);

-- ============================================================
-- BOT TASKS (Cross-bot coordination)
-- ============================================================
CREATE TABLE IF NOT EXISTS bot_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by TEXT NOT NULL,
  assigned_to TEXT NOT NULL,
  description TEXT NOT NULL,
  expected_output TEXT,
  priority INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  completed_at TIMESTAMPTZ,
  result TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_tasks_to ON bot_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON bot_tasks(status);

-- ============================================================
-- LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  level TEXT DEFAULT 'info' CHECK (level IN ('debug', 'info', 'warn', 'error')),
  event TEXT NOT NULL,
  message TEXT,
  metadata JSONB DEFAULT '{}',
  session_id TEXT,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at DESC);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all_messages" ON messages FOR ALL USING (true);
CREATE POLICY "service_all_memory" ON memory FOR ALL USING (true);
CREATE POLICY "service_all_activity" ON bot_activity_log FOR ALL USING (true);
CREATE POLICY "service_all_tasks" ON bot_tasks FOR ALL USING (true);
CREATE POLICY "service_all_logs" ON logs FOR ALL USING (true);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION get_recent_messages(limit_count INT DEFAULT 20)
RETURNS TABLE (id UUID, created_at TIMESTAMPTZ, role TEXT, content TEXT) AS $$
BEGIN
  RETURN QUERY SELECT m.id, m.created_at, m.role, m.content
  FROM messages m ORDER BY m.created_at DESC LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_active_goals()
RETURNS TABLE (id UUID, content TEXT, deadline TIMESTAMPTZ, priority INTEGER) AS $$
BEGIN
  RETURN QUERY SELECT m.id, m.content, m.deadline, m.priority
  FROM memory m WHERE m.type = 'goal'
  ORDER BY m.priority DESC, m.created_at DESC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_facts()
RETURNS TABLE (id UUID, content TEXT) AS $$
BEGIN
  RETURN QUERY SELECT m.id, m.content
  FROM memory m WHERE m.type = 'fact'
  ORDER BY m.created_at DESC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION match_messages(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
)
RETURNS TABLE (id UUID, content TEXT, role TEXT, created_at TIMESTAMPTZ, similarity FLOAT) AS $$
BEGIN
  RETURN QUERY SELECT m.id, m.content, m.role, m.created_at,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM messages m
  WHERE m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION match_memory(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
)
RETURNS TABLE (id UUID, content TEXT, type TEXT, similarity FLOAT) AS $$
BEGIN
  RETURN QUERY SELECT m.id, m.content, m.type,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM memory m
  WHERE m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
