#!/usr/bin/env python3
"""Migration safety check (CI, pull requests).

The API deploy runs migrations BEFORE it flips traffic and never undoes them, so after an
automatic flip-back the OLD release runs against the NEW schema (see docs/OPS_RUNBOOK.md,
"Releases and rollbacks"). Every migration must therefore be backward compatible
(expand/contract). This script checks the migration files a PR adds or changes:

  * applied migrations are immutable: modifying, renaming or deleting an existing file fails
    (the runner skips already-applied filenames, so an edit silently never runs);
  * new files must be named NNN_snake_case.sql with a number no other file uses;
  * new files are scanned for statements that break the previous release.

A reviewed exception is written in the file itself, with a reason (10+ characters):

    -- migration-check: allow drop-column no reader since release 2026-09, backfill done in 104

Usage: migration_check.py [--base origin/main] [--dir api/src/db/migrations] [--all]
  --all  lint every file in the directory (calibration only; existing files are never enforced).
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

RULES = {
    "drop-table": "DROP TABLE removes data/structure the previous release still reads. Expand now, drop in a later release.",
    "drop-column": "DROP COLUMN breaks the previous release. Stop using the column first, drop it in a later release.",
    "drop-type": "DROP TYPE breaks the previous release if it still references the type.",
    "rename": "RENAME breaks the previous release. Add the new name, migrate readers, remove the old name later.",
    "alter-type": "ALTER COLUMN ... TYPE rewrites the column and can break the previous release. Add a new column instead.",
    "set-not-null": "SET NOT NULL makes the previous release's NULL inserts fail. Add the constraint in a later release.",
    "add-not-null-no-default": "ADD COLUMN ... NOT NULL without DEFAULT makes the previous release's inserts fail. Add a DEFAULT or make it nullable.",
    "truncate": "TRUNCATE destroys data.",
    "unscoped-delete": "DELETE without WHERE deletes every row.",
    "unscoped-update": "UPDATE without WHERE rewrites every row; run bulk backfills as a separate job.",
    "city-boundary": "Never UPDATE cities.boundary in a migration: admins own the shapes (CLAUDE.md).",
    "rate-cards": "Never UPDATE rate_cards: insert a new row and set effective_to on the old one (CLAUDE.md).",
}

ALLOW_RE = re.compile(r"--[ \t]*migration-check:[ \t]*allow[ \t]+([a-z-]+)[ \t]+(\S[^\n]{9,})", re.IGNORECASE)
NAME_RE = re.compile(r"^(\d{3,})_[a-z0-9_]+\.sql$")


def strip_sql(text):
    """Remove comments and string literals; drop function/procedure bodies (they are code
    that runs later, not DDL/DML executed by the migration). DO blocks are kept."""
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    text = re.sub(r"--[^\n]*", " ", text)
    # dollar-quoted bodies that belong to CREATE FUNCTION/PROCEDURE
    text = re.sub(
        r"(CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\b.*?)\$(\w*)\$.*?\$\2\$",
        r"\1 ",
        text,
        flags=re.S | re.I,
    )
    text = re.sub(r"'(?:[^']|'')*'", "''", text)
    return text


def statements(text):
    cleaned = strip_sql(text)
    out = []
    for raw in cleaned.split(";"):
        s = re.sub(r"\s+", " ", raw).strip().upper()
        if s:
            out.append(s)
    return out


def split_top_level(s):
    parts, depth, cur = [], 0, []
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return parts


def lint_sql(text):
    """Return a sorted list of (rule, statement-snippet) violations."""
    found = []
    for s in statements(text):
        def hit(rule):
            found.append((rule, s[:100]))

        if re.search(r"\bDROP TABLE\b", s):
            hit("drop-table")
        if re.search(r"\bDROP COLUMN\b", s):
            hit("drop-column")
        if re.match(r"DROP TYPE\b", s):
            hit("drop-type")
        if re.search(r"\bRENAME (TO|COLUMN|VALUE)\b", s):
            hit("rename")
        if re.search(r"\bALTER COLUMN\b.*\b(SET DATA )?TYPE\b", s):
            hit("alter-type")
        if re.search(r"\bALTER COLUMN\b.*\bSET NOT NULL\b", s):
            hit("set-not-null")
        if re.match(r"ALTER TABLE\b", s):
            for clause in split_top_level(s):
                if re.search(r"\bADD COLUMN\b", clause) and re.search(r"\bNOT NULL\b", clause) \
                        and not re.search(r"\b(DEFAULT|GENERATED|IDENTITY|SERIAL|BIGSERIAL)\b", clause):
                    hit("add-not-null-no-default")
        if re.match(r"TRUNCATE\b", s):
            hit("truncate")
        if re.match(r"DELETE FROM\b", s) and not re.search(r"\bWHERE\b", s):
            hit("unscoped-delete")
        if re.match(r"UPDATE\b", s):
            if re.match(r"UPDATE (ONLY )?(PUBLIC\.)?CITIES\b.*\bSET\b.*\bBOUNDARY\b", s):
                hit("city-boundary")
            if re.match(r"UPDATE (ONLY )?(PUBLIC\.)?RATE_CARDS\b", s):
                hit("rate-cards")
            if not re.search(r"\bWHERE\b", s):
                hit("unscoped-update")
    return sorted(set(found))


def allowed_rules(text):
    return {m.group(1).lower() for m in ALLOW_RE.finditer(text)}


def check_file(path_name, text):
    """Violations for one new migration file, minus reviewed exceptions."""
    errors = []
    allow = allowed_rules(text)
    for rule, snippet in lint_sql(text):
        if rule in allow:
            continue
        errors.append(f"[{rule}] {RULES[rule]}  ->  {snippet}")
    return errors


def git(*args):
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="origin/main")
    ap.add_argument("--dir", default="api/src/db/migrations")
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    mdir = Path(args.dir)
    failures = 0

    def fail(file, msg):
        nonlocal failures
        failures += 1
        print(f"::error file={file}::{msg}")

    if args.all:
        for p in sorted(mdir.glob("*.sql")):
            errs = check_file(p.name, p.read_text(encoding="utf-8"))
            for e in errs:
                print(f"{p.name}: {e}")
        return 0

    changed = git("diff", "--name-status", "-M", f"{args.base}...HEAD", "--", str(mdir)).splitlines()
    existing_prefixes = {}
    for p in mdir.glob("*.sql"):
        m = NAME_RE.match(p.name)
        if m:
            existing_prefixes.setdefault(m.group(1), []).append(p.name)

    added = []
    for line in changed:
        status, *files = line.split("\t")
        if status.startswith("A"):
            added.append(files[0])
        elif status.startswith(("M", "D", "R", "T")):
            fail(files[0], "applied migrations are immutable: the runner skips files it already ran, so this edit/rename/delete "
                           "never reaches existing databases. Add a new migration instead.")

    if not added and failures == 0:
        print("No migration files added or changed.")
        return 0

    for f in added:
        name = Path(f).name
        m = NAME_RE.match(name)
        if not m:
            fail(f, f"migration name must look like 105_short_snake_case.sql (got {name})")
            continue
        clashes = [n for n in existing_prefixes.get(m.group(1), []) if n != name]
        if clashes:
            fail(f, f"migration number {m.group(1)} is also used by {', '.join(clashes)}; renumber (parallel PRs picked the same number)")
        text = Path(f).read_text(encoding="utf-8")
        for err in check_file(name, text):
            fail(f, err)
        # exceptions must carry a reason: an allow line without one is reported
        for rule in re.findall(r"--[ \t]*migration-check:[ \t]*allow[ \t]+([a-z-]+)[ \t]*$", text, re.I | re.M):
            fail(f, f"'migration-check: allow {rule}' needs a reason (10+ characters) after the rule name")

    if failures:
        print(f"\n{failures} migration problem(s). Migrations must stay backward compatible with the previous release "
              f"(expand/contract): docs/OPS_RUNBOOK.md, 'Releases and rollbacks'.")
        return 1
    print(f"{len(added)} new migration(s) checked: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
