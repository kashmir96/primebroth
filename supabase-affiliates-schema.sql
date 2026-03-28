-- ═══════════════════════════════════════════════════
-- PrimalPantry Affiliate System — Supabase Schema
-- Run this in your Supabase SQL Editor
-- ═══════════════════════════════════════════════════

-- Core affiliates table
CREATE TABLE IF NOT EXISTS affiliates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  social_links text,
  website text,
  audience_size text,
  reason text,
  status text DEFAULT 'pending',
  affiliate_code text UNIQUE,
  stripe_promo_code_id text,
  stripe_coupon_id text,
  referral_link text,
  commission_rate numeric DEFAULT 0.20,
  discount_rate numeric DEFAULT 0.10,
  total_clicks integer DEFAULT 0,
  total_orders integer DEFAULT 0,
  total_revenue numeric DEFAULT 0,
  total_commission numeric DEFAULT 0,
  total_paid numeric DEFAULT 0,
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliates_email ON affiliates (email);
CREATE INDEX IF NOT EXISTS idx_affiliates_code ON affiliates (affiliate_code);
CREATE INDEX IF NOT EXISTS idx_affiliates_status ON affiliates (status);

-- Orders attributed to affiliates
CREATE TABLE IF NOT EXISTS affiliate_orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  affiliate_id bigint REFERENCES affiliates(id),
  order_id bigint,
  order_email text,
  order_total numeric,
  shipping_cost numeric DEFAULT 0,
  commission_amount numeric,
  attribution_method text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aff_orders_affiliate ON affiliate_orders (affiliate_id);
CREATE INDEX IF NOT EXISTS idx_aff_orders_order ON affiliate_orders (order_id);

-- Manual payout tracking
CREATE TABLE IF NOT EXISTS affiliate_payouts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  affiliate_id bigint REFERENCES affiliates(id),
  amount numeric NOT NULL,
  period_from date,
  period_to date,
  notes text,
  paid_by text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aff_payouts_affiliate ON affiliate_payouts (affiliate_id);

-- Magic link tokens for affiliate login
CREATE TABLE IF NOT EXISTS affiliate_tokens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  affiliate_id bigint REFERENCES affiliates(id),
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aff_tokens_token ON affiliate_tokens (token);

-- Click tracking for referral links
CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  affiliate_id bigint REFERENCES affiliates(id),
  ip_hash text,
  user_agent text,
  landing_page text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aff_clicks_affiliate ON affiliate_clicks (affiliate_id);
CREATE INDEX IF NOT EXISTS idx_aff_clicks_created ON affiliate_clicks (created_at DESC);

-- Add affiliate tracking columns to existing orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS affiliate_id bigint;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_code text;
