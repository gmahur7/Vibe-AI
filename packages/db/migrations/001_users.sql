CREATE TABLE users (
  id                  BIGINT PRIMARY KEY,                  -- Snowflake ID
  username            TEXT UNIQUE NOT NULL,
  email               TEXT UNIQUE NOT NULL,
  phone_no            TEXT UNIQUE,
  password            TEXT NOT NULL,                       -- argon2id
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  avatar_key          TEXT,                                -- object storage key, not a URL

  last_login_at       TIMESTAMPTZ,
  last_login_ip       INET,

  is_email_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at   TIMESTAMPTZ,                         -- NULL = not verified

  failed_login_count  INT NOT NULL DEFAULT 0,
  locked_until        TIMESTAMPTZ,

  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','inactive','suspended','deleted')),

  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,                      

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,

  -- status and deleted_at must agree
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL))
);
