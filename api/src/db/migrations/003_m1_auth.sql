-- M02: Auth & Identity tables

CREATE SEQUENCE user_code_seq START 1;
CREATE SEQUENCE driver_code_seq START 1;
CREATE SEQUENCE admin_code_seq START 1;

-- ─── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id              BIGSERIAL PRIMARY KEY,
  code            TEXT UNIQUE NOT NULL
                    DEFAULT 'USR' || LPAD(nextval('user_code_seq')::TEXT, 6, '0'),
  phone           TEXT UNIQUE NOT NULL,
  name            TEXT,
  email           CITEXT,
  status          user_status NOT NULL DEFAULT 'active',
  referral_code   TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::TEXT,
  referred_by_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  fcm_token       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX users_phone_idx ON users (phone);
CREATE INDEX users_status_idx ON users (status);

-- ─── Drivers ─────────────────────────────────────────────────────────────────
CREATE TABLE drivers (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL
                DEFAULT 'DRV' || LPAD(nextval('driver_code_seq')::TEXT, 6, '0'),
  phone       TEXT UNIQUE NOT NULL,
  name        TEXT,
  email       CITEXT,
  status      driver_status NOT NULL DEFAULT 'pending_docs',
  fcm_token   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX drivers_phone_idx ON drivers (phone);
CREATE INDEX drivers_status_idx ON drivers (status);

-- ─── Admins ──────────────────────────────────────────────────────────────────
CREATE TABLE admins (
  id             BIGSERIAL PRIMARY KEY,
  code           TEXT UNIQUE NOT NULL
                   DEFAULT 'ADM' || LPAD(nextval('admin_code_seq')::TEXT, 6, '0'),
  email          CITEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  role           admin_role NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── OTP requests ────────────────────────────────────────────────────────────
-- DB audit trail only; live OTP state lives in Redis for fast TTL lookups.
CREATE TABLE otp_requests (
  id              BIGSERIAL PRIMARY KEY,
  principal_role  principal_role NOT NULL,
  phone           TEXT NOT NULL,
  purpose         otp_purpose NOT NULL,
  otp_hash        TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX otp_requests_phone_created_idx
  ON otp_requests (phone, purpose, created_at DESC);

-- ─── Refresh tokens ──────────────────────────────────────────────────────────
-- Stores SHA-256 hashes of refresh tokens. Bare token never persisted.
CREATE TABLE refresh_tokens (
  id              BIGSERIAL PRIMARY KEY,
  principal_role  principal_role NOT NULL,
  principal_id    BIGINT NOT NULL,
  token_hash      TEXT UNIQUE NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_principal_idx
  ON refresh_tokens (principal_role, principal_id);
CREATE INDEX refresh_tokens_hash_idx
  ON refresh_tokens (token_hash) WHERE revoked_at IS NULL;
