-- Quiz leads table
CREATE TABLE IF NOT EXISTS quiz_leads (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text,
  concerns text[] DEFAULT '{}',
  areas text[] DEFAULT '{}',
  preference text,
  sensitivity int,
  allergens text[] DEFAULT '{}',
  severity text,
  frequency text,
  recommended_products text[] DEFAULT '{}',
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
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quiz_referrals_friend ON quiz_referrals (friend_email);
