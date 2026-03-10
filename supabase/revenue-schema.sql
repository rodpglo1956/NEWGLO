-- Revenue Tracking table
-- Tracks all revenue events across the ecosystem
CREATE TABLE IF NOT EXISTS revenue_tracking (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL,        -- 'property', 'trading', 'sales', 'dropshipping', 'consulting'
  category TEXT,               -- subcategory
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  description TEXT,
  bot_id TEXT,                 -- which bot generated this
  deal_id TEXT,                -- optional link to deals/pipeline
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_revenue_source ON revenue_tracking(source);
CREATE INDEX IF NOT EXISTS idx_revenue_created ON revenue_tracking(created_at DESC);

-- Product Status table
-- Tracks status of all 19 products in the Kaldr Tech portfolio
CREATE TABLE IF NOT EXISTS product_status (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  tier TEXT NOT NULL DEFAULT 'tier2',  -- 'tier1' or 'tier2'
  industry TEXT,
  product_type TEXT,
  status TEXT NOT NULL DEFAULT 'planning',  -- planning, building, live, paused
  arr_potential TEXT,           -- tier1: ARR target
  mrr_potential TEXT,           -- tier2: MRR target
  notes TEXT,
  updated_by TEXT,             -- bot or user who last updated
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_status ON product_status(status);

-- Seed the 19 products
INSERT INTO product_status (name, tier, industry, status, arr_potential) VALUES
  ('ChairLord', 'tier1', 'Beauty & Grooming', 'planning', '$22.5M'),
  ('CoverBase', 'tier1', 'Insurance Agencies', 'planning', '$26.8M'),
  ('TaxVault', 'tier1', 'Tax Preparation', 'planning', '$47.8M'),
  ('PropStack', 'tier1', 'Real Estate', 'planning', '$54M'),
  ('StudioVault', 'tier1', 'Content Creators', 'planning', '$33.1M')
ON CONFLICT (name) DO NOTHING;

INSERT INTO product_status (name, tier, product_type, status, mrr_potential) VALUES
  ('ProofStack', 'tier2', 'Review Mgmt', 'planning', '$30k+'),
  ('BookedOut', 'tier2', 'Appointments', 'planning', '$50k+'),
  ('FieldPulse', 'tier2', 'Lead Response', 'building', '$118k+'),
  ('GigClosed', 'tier2', 'Proposals', 'planning', '$125k+'),
  ('VaultMenu', 'tier2', 'Restaurant', 'planning', '$26k+'),
  ('ShiftBoard', 'tier2', 'Scheduling', 'planning', '$65k+'),
  ('RentReady', 'tier2', 'Maintenance', 'planning', '$118k+'),
  ('CompliBot', 'tier2', 'Compliance', 'planning', '$149k+'),
  ('ClaimBack', 'tier2', 'Claims', 'planning', '$50k+'),
  ('RemitFlow', 'tier2', 'Remittance', 'planning', '$25k+'),
  ('CrewPay', 'tier2', 'Tip Splitting', 'planning', '$10k+'),
  ('PetLoop', 'tier2', 'Pet Services', 'planning', '$20k+'),
  ('PageBound', 'tier2', 'Social Reading', 'planning', '$50k+'),
  ('Edge', 'tier2', 'Video Chat', 'planning', '$100k+')
ON CONFLICT (name) DO NOTHING;

-- Bot messages table (for command center chat)
CREATE TABLE IF NOT EXISTS bot_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_id TEXT NOT NULL,
  role TEXT NOT NULL,           -- 'user' or 'assistant'
  content TEXT NOT NULL,
  channel TEXT DEFAULT 'web',   -- 'web', 'telegram', 'api'
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_messages_bot ON bot_messages(bot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_messages_channel ON bot_messages(channel);

-- Memory table (for bot facts and goals)
CREATE TABLE IF NOT EXISTS memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL,            -- 'fact', 'goal', 'completed_goal'
  content TEXT NOT NULL,
  metadata JSONB,
  deadline TIMESTAMPTZ,
  bot_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_type ON memory(type);
