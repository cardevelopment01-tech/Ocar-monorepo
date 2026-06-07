-- Required PostgreSQL extensions for Evatril platform
-- Run once on fresh database

-- PostGIS: spatial types, ST_DWithin, ST_Covers, geography type
CREATE EXTENSION IF NOT EXISTS postgis;

-- pgcrypto: gen_random_uuid() for UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- citext: case-insensitive text type for email columns
CREATE EXTENSION IF NOT EXISTS citext;
