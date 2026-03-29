-- PrimalPoints Loyalty System
-- Run this in your Supabase SQL Editor

-- 1. Points ledger (every earn/redeem/expire transaction)
CREATE TABLE IF NOT EXISTS loyalty_points (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  points        INTEGER NOT NULL,        -- positive = earn, negative = redeem/expire
  type          TEXT NOT NULL,           -- 'purchase' | 'spin' | 'bonus' | 'redeem' | 'expire'
  order_id      TEXT,                    -- Stripe session ID (cs_live_xxx)
  description   TEXT,
  expires_at    TIMESTAMPTZ,             -- 60 days from earn date (null for redeem/expire rows)
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS loyalty_points_email_idx ON loyalty_points(email);
CREATE INDEX IF NOT EXISTS loyalty_points_expires_idx ON loyalty_points(expires_at);

-- 2. Global settings (single row)
CREATE TABLE IF NOT EXISTS loyalty_settings (
  id                    INTEGER PRIMARY KEY DEFAULT 1,
  points_per_dollar     INTEGER NOT NULL DEFAULT 50,    -- pts earned per $1 spent
  points_to_dollar_rate INTEGER NOT NULL DEFAULT 1000,  -- pts needed for $1 redemption
  min_redemption_points INTEGER NOT NULL DEFAULT 1000,  -- minimum to redeem
  double_points_active  BOOLEAN NOT NULL DEFAULT FALSE,
  double_points_sku     TEXT,                           -- null = all products
  double_points_until   TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default settings
INSERT INTO loyalty_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 3. Spin game log
CREATE TABLE IF NOT EXISTS loyalty_spins (
  id              BIGSERIAL PRIMARY KEY,
  email           TEXT,
  token           TEXT UNIQUE NOT NULL,   -- unique link token from email
  points_won      INTEGER,
  spun_at         TIMESTAMPTZ,            -- null = not yet spun
  friends_shared  TEXT[],
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS loyalty_spins_token_idx ON loyalty_spins(token);
CREATE INDEX IF NOT EXISTS loyalty_spins_email_idx ON loyalty_spins(email);
