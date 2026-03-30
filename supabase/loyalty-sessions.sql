-- PrimalPoints magic-link login sessions
-- Run once against Supabase SQL editor

CREATE TABLE IF NOT EXISTS loyalty_tokens (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       text NOT NULL,
  token       text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used        boolean DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_tokens_token ON loyalty_tokens (token);
CREATE INDEX IF NOT EXISTS idx_loyalty_tokens_email ON loyalty_tokens (email);

CREATE TABLE IF NOT EXISTS loyalty_sessions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email          text NOT NULL,
  session_token  text NOT NULL UNIQUE,
  created_at     timestamptz DEFAULT now(),
  expires_at     timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_loyalty_sessions_token ON loyalty_sessions (session_token);
CREATE INDEX IF NOT EXISTS idx_loyalty_sessions_email ON loyalty_sessions (email);
