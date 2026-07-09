# ADR-002: PostgreSQL + PostGIS over MySQL

**Status:** Accepted

## Context

The platform needs a relational database that can handle three spatial operations that are on the critical path for every ride:

1. **Driver matching**: find all active drivers within N metres of a user's pickup point.
2. **Return-cab corridor matching**: find drivers whose current route passes within 2 km of the user's pickup-to-drop corridor (a LineString).
3. **Rental boundary enforcement**: check whether a drop-off point falls within a city's operational polygon (ST_Covers on a polygon).

## Decision

Use PostgreSQL 16 with the PostGIS 3.4 extension. Run via the `postgis/postgis:16-3.4` Docker image.

## Why PostgreSQL over MySQL

**Partial indexes.** MySQL has no partial indexes. PostgreSQL supports `CREATE INDEX ... WHERE condition`, which lets the driver-matching query use an index that only contains `online` and `on_trip` drivers, excluding `offline` drivers from the index entirely. At scale (100k+ driver rows) this is a significant read performance win with no write penalty for offline driver updates.

**JSONB.** Config values, webhook payloads, and feature flag metadata are variable-shape JSON. PostgreSQL's `jsonb` type supports GIN-indexed key lookups. MySQL's JSON column has limited index support.

**Window functions and CTEs.** Settlement calculations, ride history pagination, and analytics aggregations use `WINDOW`, `LATERAL`, and recursive CTEs that are either unsupported or poorly optimised in MySQL.

**Enum types.** PostgreSQL's `CREATE TYPE ... AS ENUM` provides a compact, constraint-enforced enum at the DB layer. MySQL enums are strings without the type system guarantees.

## Why PostGIS specifically

PostGIS adds a `geography` type and spatial functions that PostgreSQL's core does not include. The three operations above require:

| Operation | Function used | Why PostGIS |
|---|---|---|
| Driver radius search | `ST_DWithin(geography, geography, metres)` | Uses spherical earth model; accurate at Indian latitudes |
| Corridor match | `ST_DWithin(line_geography, point_geography, 2000)` | Line-to-point distance on a sphere |
| Rental boundary | `ST_Covers(polygon_geography, point_geography)` | Polygon containment with geography type |

## `geography` type over `geometry` type

PostGIS has two spatial type systems: `geometry` (flat-plane Cartesian) and `geography` (WGS84 spherical).

For driver matching, using `geometry` with a Mercator projection introduces distance errors that grow with latitude. India spans roughly 8°N to 37°N. At 28°N (Delhi), a flat-plane calculation is off by ~2%. At a 2 km matching radius, that's a 40-metre error, larger than a car. The `geography` type calculates on the spherical earth model and is accurate to <1 metre anywhere on the globe.

Using `geography` incurs a ~20–30% CPU overhead vs `geometry` for spatial operations. This is acceptable given the accuracy requirement, and GIST spatial indexes on `geography` columns keep these queries well under 10ms even at scale.

## MySQL's partial index gap

The `driver_sessions` table will have ~50k rows in steady state. The ride-dispatch hot path queries only the subset where `state IN ('online', 'on_trip')`, which at peak is ~20% of rows. Without a partial index, MySQL reads all 50k index entries and filters. With PostgreSQL's partial index on `(location) WHERE state IN ('online', 'on_trip')`, the index contains only ~10k entries. This keeps the spatial lookup fast as the driver pool grows.
