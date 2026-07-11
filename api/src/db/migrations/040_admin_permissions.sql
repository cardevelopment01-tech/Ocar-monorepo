-- Admin Onboarding & RBAC — Phase 4: permissions + role_permissions
-- See docs/ADMIN_RBAC_PLAN.md. Role enum stays the primary unit; this join gives
-- fine-grained overrides without full ABAC. super_admin is seeded with every
-- permission for audit-table truthfulness, but authorize() also short-circuits
-- role === 'super_admin' so a missing/corrupt seed row can never lock it out.

CREATE TABLE permissions (
  id          BIGSERIAL PRIMARY KEY,
  slug        VARCHAR(80) NOT NULL UNIQUE,
  description VARCHAR(160) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  role          admin_role NOT NULL,
  permission_id BIGINT NOT NULL REFERENCES permissions(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role, permission_id)
);

-- Load full permission set for a role at login/authorize() time
CREATE INDEX role_permissions_role_idx ON role_permissions (role);

INSERT INTO permissions (slug, description) VALUES
  ('drivers.view',                    'View driver profiles and documents'),
  ('drivers.approve',                 'Approve pending driver applications'),
  ('drivers.suspend',                 'Suspend or ban a driver account'),
  ('vehicles.manage',                 'Manage vehicle categories, brands, fleet'),
  ('rides.view',                      'View ride list and detail'),
  ('rides.cancel',                    'Force-cancel a ride'),
  ('users.view',                      'View user/rider profiles'),
  ('users.suspend',                   'Suspend a user/rider account'),
  ('disputes.manage',                 'Investigate and resolve disputes'),
  ('sos.manage',                      'Acknowledge and resolve SOS alerts'),
  ('pricing.manage',                  'Edit rate cards, surge, rental packages'),
  ('payments.view',                   'View payment and wallet ledger records'),
  ('payments.refund',                 'Approve and initiate refunds'),
  ('settlements.manage',              'Initiate driver settlements'),
  ('analytics.view',                  'View revenue/rides/driver analytics dashboards'),
  ('admins.invite',                   'Send admin invitations'),
  ('admins.manage',                   'Suspend/reactivate admin accounts'),
  ('notification_templates.manage',   'Edit SMS/push/email template copy');

INSERT INTO role_permissions (role, permission_id)
SELECT v.role::admin_role, p.id
FROM (VALUES
  -- drivers.view — all roles
  ('super_admin',   'drivers.view'),
  ('ops_admin',     'drivers.view'),
  ('support_admin', 'drivers.view'),
  ('finance_admin', 'drivers.view'),
  -- drivers.approve — super + ops
  ('super_admin',   'drivers.approve'),
  ('ops_admin',     'drivers.approve'),
  -- drivers.suspend — super + ops
  ('super_admin',   'drivers.suspend'),
  ('ops_admin',     'drivers.suspend'),
  -- vehicles.manage — super + ops
  ('super_admin',   'vehicles.manage'),
  ('ops_admin',     'vehicles.manage'),
  -- rides.view — all roles
  ('super_admin',   'rides.view'),
  ('ops_admin',     'rides.view'),
  ('support_admin', 'rides.view'),
  ('finance_admin', 'rides.view'),
  -- rides.cancel — super + ops + support
  ('super_admin',   'rides.cancel'),
  ('ops_admin',     'rides.cancel'),
  ('support_admin', 'rides.cancel'),
  -- users.view — all roles
  ('super_admin',   'users.view'),
  ('ops_admin',     'users.view'),
  ('support_admin', 'users.view'),
  ('finance_admin', 'users.view'),
  -- users.suspend — super + ops
  ('super_admin',   'users.suspend'),
  ('ops_admin',     'users.suspend'),
  -- disputes.manage — super + support
  ('super_admin',   'disputes.manage'),
  ('support_admin', 'disputes.manage'),
  -- sos.manage — super + ops + support
  ('super_admin',   'sos.manage'),
  ('ops_admin',     'sos.manage'),
  ('support_admin', 'sos.manage'),
  -- pricing.manage — super + finance
  ('super_admin',   'pricing.manage'),
  ('finance_admin', 'pricing.manage'),
  -- payments.view — super + finance
  ('super_admin',   'payments.view'),
  ('finance_admin', 'payments.view'),
  -- payments.refund — super + finance
  ('super_admin',   'payments.refund'),
  ('finance_admin', 'payments.refund'),
  -- settlements.manage — super + finance
  ('super_admin',   'settlements.manage'),
  ('finance_admin', 'settlements.manage'),
  -- analytics.view — super + ops + finance
  ('super_admin',   'analytics.view'),
  ('ops_admin',     'analytics.view'),
  ('finance_admin', 'analytics.view'),
  -- admins.invite — super only
  ('super_admin',   'admins.invite'),
  -- admins.manage — super only
  ('super_admin',   'admins.manage'),
  -- notification_templates.manage — super + ops
  ('super_admin',   'notification_templates.manage'),
  ('ops_admin',     'notification_templates.manage')
) AS v(role, slug)
JOIN permissions p ON p.slug = v.slug;
