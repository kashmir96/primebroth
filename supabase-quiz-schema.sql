-- Quiz leads table
CREATE TABLE IF NOT EXISTS quiz_leads (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text,
  concerns text[] DEFAULT '{}',
  areas text[] DEFAULT '{}',
  preference text,
  sensitivity int,
  allergens text[] DEFAULT '{}',
  allergen_other text,
  severity text,
  frequency text,
  age_group text,
  gender text,
  tried_before text[] DEFAULT '{}',
  tallow_feedback text,
  hydration text,
  recommended_products text[] DEFAULT '{}',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  referrer text,
  landing_page text,
  order_id bigint,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quiz_leads_email ON quiz_leads (email);
CREATE INDEX IF NOT EXISTS idx_quiz_leads_created ON quiz_leads (created_at DESC);

-- Quiz referrals table
CREATE TABLE IF NOT EXISTS quiz_referrals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referrer_email text NOT NULL,
  friend_email text NOT NULL,
  referrer_code text,
  friend_code text,
  expires_at timestamptz,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quiz_referrals_friend ON quiz_referrals (friend_email);
CREATE INDEX IF NOT EXISTS idx_quiz_referrals_referrer ON quiz_referrals (referrer_email);

-- Migration: add missing columns if upgrading from old schema
-- Run these if the tables already exist:
-- ALTER TABLE quiz_referrals ADD COLUMN IF NOT EXISTS expires_at timestamptz;
-- ALTER TABLE quiz_referrals ADD COLUMN IF NOT EXISTS utm_source text;
-- ALTER TABLE quiz_referrals ADD COLUMN IF NOT EXISTS utm_medium text;
-- ALTER TABLE quiz_referrals ADD COLUMN IF NOT EXISTS utm_campaign text;
-- ALTER TABLE quiz_referrals ADD COLUMN IF NOT EXISTS utm_term text;
-- ALTER TABLE quiz_referrals ADD COLUMN IF NOT EXISTS utm_content text;
-- ALTER TABLE quiz_leads ADD COLUMN IF NOT EXISTS allergen_other text;
-- ALTER TABLE quiz_leads ADD COLUMN IF NOT EXISTS age_group text;
-- ALTER TABLE quiz_leads ADD COLUMN IF NOT EXISTS gender text;
-- ALTER TABLE quiz_leads ADD COLUMN IF NOT EXISTS tried_before text[] DEFAULT '{}';
-- ALTER TABLE quiz_leads ADD COLUMN IF NOT EXISTS tallow_feedback text;
-- ALTER TABLE quiz_leads ADD COLUMN IF NOT EXISTS hydration text;
-- ALTER TABLE quiz_leads ADD COLUMN IF NOT EXISTS utm_source text;
-- ALTER TABLE quiz_leads ADD COLUMN IF NOT EXISTS utm_medium text;
-- ALTER TABLE quiz_leads ADD COLUMN IF NOT EXISTS utm_campaign text;
-- ALTER TABLE quiz_leads ADD COLUMN IF NOT EXISTS utm_term text;
-- ALTER TABLE quiz_leads ADD COLUMN IF NOT EXISTS utm_content text;
-- ALTER TABLE quiz_leads ADD COLUMN IF NOT EXISTS referrer text;
-- ALTER TABLE quiz_leads ADD COLUMN IF NOT EXISTS landing_page text;
-- ALTER TABLE quiz_leads ADD COLUMN IF NOT EXISTS order_id bigint;
