import importlib.util
import unittest
from pathlib import Path

HERE = Path(__file__).parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


mc = load("migration_check")
sm = load("api_smoke")


def rules(sql):
    return {r for r, _ in mc.lint_sql(sql)}


class MigrationLint(unittest.TestCase):
    def test_additive_changes_pass(self):
        sql = """
        CREATE TABLE IF NOT EXISTS wallet_topup_orders (id BIGINT PRIMARY KEY, amount NUMERIC NOT NULL);
        ALTER TABLE drivers ADD COLUMN IF NOT EXISTS nickname TEXT;
        ALTER TABLE drivers ADD COLUMN flag BOOLEAN NOT NULL DEFAULT false;
        CREATE INDEX IF NOT EXISTS idx_x ON drivers (nickname) WHERE status = 'active';
        UPDATE rides SET status = 'cancelled' WHERE id = 1;
        INSERT INTO system_config (key, value) VALUES ('a', 'DROP TABLE x');
        """
        self.assertEqual(rules(sql), set())

    def test_destructive_statements_are_flagged(self):
        cases = {
            "drop-table": "DROP TABLE old_things;",
            "drop-column": "ALTER TABLE t DROP COLUMN c;",
            "drop-type": "DROP TYPE my_enum;",
            "rename": "ALTER TABLE t RENAME COLUMN a TO b;",
            "alter-type": "ALTER TABLE t ALTER COLUMN a TYPE BIGINT;",
            "set-not-null": "ALTER TABLE t ALTER COLUMN a SET NOT NULL;",
            "add-not-null-no-default": "ALTER TABLE t ADD COLUMN a TEXT NOT NULL;",
            "truncate": "TRUNCATE TABLE t;",
            "unscoped-delete": "DELETE FROM t;",
            "unscoped-update": "UPDATE t SET a = 1;",
            "city-boundary": "UPDATE cities SET boundary = x WHERE slug = 'a';",
            "rate-cards": "UPDATE rate_cards SET km = 1 WHERE id = 2;",
        }
        for rule, sql in cases.items():
            self.assertIn(rule, rules(sql), sql)

    def test_multi_clause_alter_checks_each_added_column(self):
        sql = "ALTER TABLE t ADD COLUMN ok INT NOT NULL DEFAULT 0, ADD COLUMN bad INT NOT NULL;"
        self.assertEqual(rules(sql), {"add-not-null-no-default"})

    def test_comments_and_strings_do_not_trigger(self):
        sql = """
        -- DROP TABLE nope;
        /* ALTER TABLE t DROP COLUMN c; */
        INSERT INTO notes (body) VALUES ('please DROP TABLE x; and TRUNCATE y');
        """
        self.assertEqual(rules(sql), set())

    def test_function_bodies_are_not_ddl(self):
        sql = """
        CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
        BEGIN
          UPDATE audit SET touched = true;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
        self.assertEqual(rules(sql), set())

    def test_do_blocks_are_checked(self):
        sql = "DO $$ BEGIN ALTER TABLE t DROP COLUMN c; END $$;"
        self.assertIn("drop-column", rules(sql))

    def test_reviewed_exception_needs_rule_and_reason(self):
        sql = "-- migration-check: allow drop-column nothing reads it since release 2026-09, data kept in 104\nALTER TABLE t DROP COLUMN c;"
        self.assertEqual(mc.check_file("110_x.sql", sql), [])
        no_reason = "-- migration-check: allow drop-column\nALTER TABLE t DROP COLUMN c;"
        self.assertTrue(mc.check_file("110_x.sql", no_reason))  # still an error without a reason
        other_rule = "-- migration-check: allow rename a perfectly good reason here\nALTER TABLE t DROP COLUMN c;"
        self.assertTrue(mc.check_file("110_x.sql", other_rule))  # exception is per rule

    def test_file_name_pattern(self):
        self.assertTrue(mc.NAME_RE.match("107_add_thing.sql"))
        self.assertFalse(mc.NAME_RE.match("add_thing.sql"))
        self.assertFalse(mc.NAME_RE.match("107-add-thing.sql"))
        self.assertFalse(mc.NAME_RE.match("107_Add_Thing.sql"))


class ApiSmoke(unittest.TestCase):
    def run_with(self, responses):
        original = sm.call

        def fake(alb, host, color, method, path, body, ctype):
            status, data, head = responses.get(path, (200, "{}", ""))
            return status, data.replace(" ", ""), head

        sm.call = fake
        try:
            return sm.run_once("alb", "host", "blue")
        finally:
            sm.call = original

    def good(self):
        return {
            "/health": (200, '{"status":"ok","db":"ok","redis":"ok"}', ""),
            "/api/v1/geo/cities": (200, '[{"slug":"angul"}]', ""),
            "/api/v1/auth/otp/request": (422, '{"code":"VALIDATION_ERROR"}', ""),
            "/api/v1/payments/wallet/driver": (401, '{"code":"AUTH_UNAUTHORIZED"}', ""),
            "/api/v1/rides/active": (401, '{"code":"AUTH_UNAUTHORIZED"}', ""),
            "/api/v1/admin/drivers": (401, '{"code":"AUTH_UNAUTHORIZED"}', ""),
            "/api/v1/payments/payu/sdk-hash": (401, '{"code":"AUTH_UNAUTHORIZED"}', ""),
            "/api/v1/payments/payu/confirm": (401, '{"code":"AUTH_UNAUTHORIZED"}', ""),
            "/api/v1/payments/payu/return": (303, "", "location: https://x/\n"),
            "/api/v1/payments/webhook/payu": (200, '{"status":"ok"}', ""),
        }

    def test_all_good(self):
        self.assertEqual(self.run_with(self.good()), [])

    def test_db_down_fails(self):
        r = self.good()
        r["/health"] = (200, '{"status":"ok","db":"error","redis":"ok"}', "")
        self.assertTrue(any("health" in f for f in self.run_with(r)))

    def test_missing_route_fails(self):
        r = self.good()
        r["/api/v1/payments/payu/sdk-hash"] = (404, "", "")
        self.assertTrue(any("sdk-hash" in f for f in self.run_with(r)))

    def test_open_endpoint_that_should_require_auth_fails(self):
        r = self.good()
        r["/api/v1/admin/drivers"] = (200, "[]", "")
        self.assertTrue(any("admin" in f for f in self.run_with(r)))

    def test_webhook_error_fails(self):
        r = self.good()
        r["/api/v1/payments/webhook/payu"] = (500, "", "")
        self.assertTrue(any("webhook" in f for f in self.run_with(r)))


if __name__ == "__main__":
    unittest.main()
