# Lets GitHub Actions authenticate to AWS with short-lived tokens instead of
# static access keys stored as a repo secret -- the deploy job proves its
# identity via a signed OIDC token GitHub itself issues per workflow run.

# This is a read-only lookup, not ownership -- the provider itself is
# created/managed once in infra/terraform/bootstrap/ (see
# docs/superpowers/plans/2026-08-15-terraform-bootstrap-singleton-split.md
# for why). Every prod/staging apply just needs its ARN, never needs to
# create or modify it.
data "aws_iam_openid_connect_provider" "github_actions" {
  url = "https://token.actions.githubusercontent.com"
}

# Read-only lookups -- the state bucket and its KMS key are owned by
# infra/terraform/bootstrap/, not this config. Same reasoning as the OIDC
# provider data source above.
data "aws_s3_bucket" "terraform_state" {
  bucket = "ocar-terraform-state"
}

data "aws_kms_key" "terraform_state" {
  key_id = "alias/ocar-terraform-state"
}

# Scoped to exactly this repo. The deploy job in deploy.yml declares
# `environment: production`, which changes GitHub's OIDC sub claim format
# from the usual ref-based one (repo:OWNER/REPO:ref:refs/heads/main) to an
# environment-based one instead -- confirmed via the actual rejected claim
# in CloudTrail after the ref-based condition failed for real.
resource "aws_iam_role" "github_actions_deploy" {
  name = "${var.project_name}-${var.environment}-gha-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github_actions.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:cardevelopment01-tech/Ocar-monorepo:environment:production"
        }
      }
    }]
  })

  tags = {
    Name = "${var.project_name}-${var.environment}-gha-deploy"
  }
}

# Least privilege: only what the blue/green deploy job actually does --
# read/write the per-color image-tag + active-color SSM params, scale the
# idle color up and the old color down (suspending/resuming each color's own
# scaling policy around that window so it can't fight the manual capacity
# change), flip the ALB listener at cutover, and watch the bake window via
# CloudWatch -- plus the pre-existing migration-routing permissions (find a
# live instance, run the migration over SSM, read RDS connection info).
resource "aws_iam_role_policy" "github_actions_deploy" {
  name = "${var.project_name}-${var.environment}-gha-deploy-policy"
  role = aws_iam_role.github_actions_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Reads/writes the per-color image-tag params (which color to deploy
        # which image to) and the active-color param (which color is
        # currently live).
        Effect = "Allow"
        Action = ["ssm:GetParameter", "ssm:PutParameter"]
        Resource = concat(
          [for c in local.colors : local.image_tag_parameter_arns[c]],
          [local.active_color_parameter_arn]
        )
      },
      {
        # Reads the Grafana Cloud Service Account token + URL to push a
        # deploy annotation at cutover/rollback -- marks exactly when a
        # test/incident happened on the dashboards. Read-only; hardcoded
        # /ocar/observability/ path (not var.environment-scoped) because
        # this is the one account-wide Grafana Cloud stack
        # (infra/terraform/observability/), same credentials whether this
        # role belongs to prod or staging.
        Effect = "Allow"
        Action = ["ssm:GetParameter"]
        Resource = [
          "${local.ssm_parameter_arn_prefix}/ocar/observability/grafana-auth",
          "${local.ssm_parameter_arn_prefix}/ocar/observability/grafana-url",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = local.ssm_kms_key_arn
      },
      {
        # Scale the idle color up before cutover, scale the old color down
        # after the bake window, and suspend/resume each color's own
        # target-tracking policy around those windows so it can't fight the
        # deploy workflow's manual desired_capacity changes -- see
        # deploy.yml's "Suspend"/"Resume" steps for why this is needed.
        Effect   = "Allow"
        Action   = ["autoscaling:UpdateAutoScalingGroup", "autoscaling:SuspendProcesses", "autoscaling:ResumeProcesses"]
        Resource = [for c in local.colors : aws_autoscaling_group.api[c].arn]
      },
      {
        # elasticloadbalancing:Describe* actions do NOT support
        # resource-level IAM scoping at all (confirmed the hard way live in
        # production: DescribeTargetHealth/DescribeTargetGroups scoped to
        # specific target-group ARNs returned AccessDenied on every single
        # call, mid-deploy, because a scoped Resource simply never matches
        # for an action that requires "*"). Every Describe* action this
        # workflow calls -- target health/target groups (polling before
        # cutover and during bake), listeners (resolving the listener ARN
        # before flipping it), load balancers (resolving the ALB's own ARN
        # from its name) -- must be "*", full stop.
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:DescribeTargetHealth",
          "elasticloadbalancing:DescribeTargetGroups",
          "elasticloadbalancing:DescribeListeners",
          "elasticloadbalancing:DescribeLoadBalancers",
        ]
        Resource = "*"
      },
      {
        # The one atomic cutover action -- flips the listener's default
        # target group from the old color to the new one, and back again on
        # a failed bake. Unlike the Describe* actions above, ModifyListener
        # is a mutating action and does support resource-level scoping.
        Effect   = "Allow"
        Action   = ["elasticloadbalancing:ModifyListener"]
        Resource = aws_lb_listener.https.arn
      },
      {
        # Bake-window monitoring (HTTPCode_Target_5XX_Count) -- CloudWatch
        # read actions don't support resource-level scoping.
        Effect   = "Allow"
        Action   = ["cloudwatch:GetMetricStatistics"]
        Resource = "*"
      },
      {
        # Finds a live instance on the currently-active color to route the
        # migration command to. No resource-level scoping possible before
        # the instance exists (IDs are dynamic).
        Effect   = "Allow"
        Action   = ["ec2:DescribeInstances"]
        Resource = "*"
      },
      {
        # Runs the migration container on that instance via SSM instead of
        # `docker run` on this runner. Needs both the built-in document ARN
        # and the target instance ARN allowed -- instance/* because, same as
        # above, the specific instance ID isn't known ahead of time.
        Effect = "Allow"
        Action = ["ssm:SendCommand"]
        Resource = [
          "arn:aws:ssm:${data.aws_region.current.region}::document/AWS-RunShellScript",
          "arn:aws:ec2:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:instance/*",
        ]
      },
      {
        # Same non-scopability situation as DescribeInstanceRefreshes used to
        # be -- GetCommandInvocation doesn't support resource-level scoping.
        Effect   = "Allow"
        Action   = ["ssm:GetCommandInvocation"]
        Resource = "*"
      },
      {
        # Reads DB host/port/name/user/secret-ARN live from RDS at deploy
        # time instead of a hand-maintained SSM parameter -- see
        # docs/INCIDENT_2026-08-25_PROD_DB_AUTH_OUTAGE.md. Confirmed via a
        # real CI failure (AccessDenied) the first time this step ran.
        # Scoped to the one instance this config manages, not "*".
        Effect   = "Allow"
        Action   = ["rds:DescribeDBInstances"]
        Resource = aws_db_instance.main.arn
      }
    ]
  })
}

output "github_actions_deploy_role_arn" {
  description = "IAM role ARN for the deploy workflow's aws-actions/configure-aws-credentials step"
  value       = aws_iam_role.github_actions_deploy.arn
}

# Separate, broader-but-still-read-only role for `terraform plan` on PRs --
# plan needs to read the current state of everything this config manages
# just to compute a diff, which is a fundamentally different (and larger)
# permission set than the deploy role's narrow write access to two actions.
# Scoped to pull_request events specifically, not main -- this role never
# runs on a push to main, the deploy role covers that.
resource "aws_iam_role" "github_actions_plan" {
  name = "${var.project_name}-${var.environment}-gha-plan"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github_actions.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:cardevelopment01-tech/Ocar-monorepo:pull_request"
        }
      }
    }]
  })

  tags = {
    Name = "${var.project_name}-${var.environment}-gha-plan"
  }
}

resource "aws_iam_role_policy" "github_actions_plan_state" {
  name = "${var.project_name}-${var.environment}-gha-plan-state"
  role = aws_iam_role.github_actions_plan.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${data.aws_s3_bucket.terraform_state.arn}/prod/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = data.aws_s3_bucket.terraform_state.arn
      },
      {
        # state-bucket.tf makes the bucket itself (policy, versioning,
        # encryption config, public access block) a managed Terraform
        # resource, not just backend storage -- plan needs to read the
        # bucket's own configuration to refresh those, separate from the
        # state-object permissions above. Confirmed via a real CI failure
        # (s3:GetBucketPolicy denied).
        Effect   = "Allow"
        Action   = ["s3:Get*", "s3:List*"]
        Resource = data.aws_s3_bucket.terraform_state.arn
      },
      {
        # State bucket moved to SSE-KMS (customer-managed key, see
        # state-bucket.tf). Decrypt covers reading the state object;
        # GenerateDataKey is separately required to WRITE the lock file
        # object when acquiring the state lock -- confirmed via a real CI
        # failure (kms:GenerateDataKey denied) after Decrypt alone turned
        # out insufficient.
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:DescribeKey", "kms:GenerateDataKey"]
        Resource = data.aws_kms_key.terraform_state.arn
      }
    ]
  })
}

# Read-only across exactly the services this config manages -- not the AWS
# managed ReadOnlyAccess policy, which spans every service in existence.
resource "aws_iam_role_policy" "github_actions_plan_read" {
  name = "${var.project_name}-${var.environment}-gha-plan-read"
  role = aws_iam_role.github_actions_plan.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ec2:Describe*",
          "elasticloadbalancing:Describe*",
          "autoscaling:Describe*",
          "iam:Get*",
          "iam:List*",
          "acm:Describe*",
          "acm:List*",
          "elasticache:Describe*",
          "elasticache:List*",
          "ssm:Describe*",
          "ssm:GetParameter*",
          "ssm:List*",
          "kms:Describe*",
          "kms:List*",
          "kms:Get*",
          "sts:GetCallerIdentity",
        ]
        Resource = "*"
      }
    ]
  })
}

output "github_actions_plan_role_arn" {
  description = "IAM role ARN for the terraform-plan-on-PR workflow"
  value       = aws_iam_role.github_actions_plan.arn
}

# Staging apply/destroy, triggered manually via workflow_dispatch (never on
# push/PR -- staging is provisioned on demand for a load test, not on every
# commit). Broader than the prod deploy role (that one only ever touches an
# image-tag parameter + ASG refresh) because this one runs full
# terraform apply/destroy -- scoped as tightly as that requires: only the
# staging state path, and only resources this config can even create (no
# wildcard iam:* or ec2:* across the whole account).
resource "aws_iam_role" "github_actions_staging" {
  name = "${var.project_name}-${var.environment}-gha-staging"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github_actions.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:cardevelopment01-tech/Ocar-monorepo:environment:staging"
        }
      }
    }]
  })

  tags = {
    Name = "${var.project_name}-${var.environment}-gha-staging"
  }
}

resource "aws_iam_role_policy" "github_actions_staging" {
  name = "${var.project_name}-${var.environment}-gha-staging-policy"
  role = aws_iam_role.github_actions_staging.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # State access -- same shape as the plan role's policy above, but
        # scoped to staging/* instead of prod/*.
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${data.aws_s3_bucket.terraform_state.arn}/staging/*"
      },
      {
        # GetBucketLocation added alongside the others -- the
        # data.aws_s3_bucket lookup this policy itself depends on (added
        # when the state bucket moved to infra/terraform/bootstrap/) calls
        # this, not just the s3:GetObject/PutObject actions above.
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketPolicy", "s3:GetBucketVersioning", "s3:GetBucketLocation"]
        Resource = data.aws_s3_bucket.terraform_state.arn
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:DescribeKey", "kms:GenerateDataKey"]
        Resource = data.aws_kms_key.terraform_state.arn
      },
      {
        # The data.aws_iam_openid_connect_provider lookup this policy's own
        # role's trust relationship depends on (same bootstrap-module move)
        # needs its own read permissions -- ListOpenIDConnectProviders
        # doesn't support resource-level scoping (must be "*"),
        # GetOpenIDConnectProvider does.
        Effect   = "Allow"
        Action   = ["iam:ListOpenIDConnectProviders"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["iam:GetOpenIDConnectProvider"]
        Resource = data.aws_iam_openid_connect_provider.github_actions.arn
      },
      {
        # Full apply/destroy needs to create/modify/delete the resource
        # *types* this config manages -- VPC networking, the ALB, the ASG +
        # launch template, ElastiCache, ACM, and RDS. Deliberate full-service
        # wildcards: unlike the narrower per-action lists on the plan/deploy
        # roles above (which only ever do a handful of specific things),
        # this role genuinely needs broad access to these services since
        # this config exclusively manages them in this region/account, and
        # EC2/ELB/ASG/ElastiCache/RDS resources don't support useful
        # ARN-based scoping before the first apply creates them anyway.
        # rds:* added to close G-02 -- staging's `terraform apply` was
        # failing at the RDS resources without it (never caught earlier
        # since staging hadn't actually been applied since this role's
        # policy was last written).
        Effect = "Allow"
        Action = [
          "ec2:*Vpc*", "ec2:*Subnet*", "ec2:*RouteTable*", "ec2:*InternetGateway*",
          "ec2:*SecurityGroup*", "ec2:*LaunchTemplate*", "ec2:*Tags*",
          "ec2:Describe*",
          "elasticloadbalancing:*",
          "autoscaling:*",
          "elasticache:*",
          "acm:*",
          "rds:*",
        ]
        Resource = "*"
      },
      {
        # rds.tf's aws_db_instance uses manage_master_user_password = true --
        # RDS creates/rotates the master password as a Secrets Manager secret
        # on the CALLER's behalf, which means the caller (this role, during
        # `terraform apply`) needs its own secretsmanager permissions, not
        # just the EC2 instance role's read-only access (iam.tf's
        # rds_secret_read policy, a separate and already-correct concern).
        # Scoped to RDS-managed secrets' fixed naming convention
        # (`rds!db-<uuid>`) rather than "*" -- narrower than the wildcard
        # block above because secretsmanager, unlike EC2/ELB/ASG/RDS, does
        # support this kind of prefix-pattern scoping.
        Effect = "Allow"
        Action = [
          "secretsmanager:CreateSecret", "secretsmanager:DeleteSecret",
          "secretsmanager:PutSecretValue", "secretsmanager:UpdateSecretVersionStage",
          "secretsmanager:GetSecretValue", "secretsmanager:TagResource",
          "secretsmanager:DescribeSecret",
        ]
        Resource = "arn:aws:secretsmanager:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:secret:rds!*"
      },
      {
        # SSM parameters, unlike the EC2/networking actions above, DO support
        # meaningful ARN-pattern scoping -- restrict to this project's
        # staging parameter path instead of every parameter in the account.
        Effect   = "Allow"
        Action   = ["ssm:*Parameter*"]
        Resource = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/staging/*"
      },
      {
        # IAM role management, also ARN-scopeable even before the role
        # exists (unlike EC2/ELB/ASG). Scoped to only the staging-prefixed
        # role this config itself creates (the EC2 role at iam.tf:24,
        # `${var.project_name}-staging-ec2-role`) -- not every role in the
        # account. AttachRolePolicy/DetachRolePolicy are required for
        # aws_iam_role_policy_attachment.ssm_managed_instance_core (iam.tf)
        # -- restored after a brief removal (this attachment was mistakenly
        # deleted as "dead debug access" without realizing the deploy
        # workflow's `ssm:SendCommand`-based migration step depends on it).
        Effect = "Allow"
        Action = [
          "iam:GetRole", "iam:CreateRole", "iam:DeleteRole", "iam:TagRole",
          "iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy",
          "iam:AttachRolePolicy", "iam:DetachRolePolicy",
        ]
        Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-staging-*"
      },
      {
        # Instance profile management, same staging-scoped ARN pattern as
        # the IAM role statement above.
        Effect = "Allow"
        Action = [
          "iam:CreateInstanceProfile", "iam:DeleteInstanceProfile",
          "iam:AddRoleToInstanceProfile", "iam:RemoveRoleFromInstanceProfile",
          "iam:GetInstanceProfile",
        ]
        Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:instance-profile/${var.project_name}-staging-*"
      },
      {
        # iam:PassRole with Resource="*" is a privilege-escalation primitive
        # -- it would let this role pass ANY role in the account to any
        # service, not just the EC2 role this config manages. Scoped to the
        # staging-prefixed role ARN plus a service condition so it can only
        # be passed to EC2.
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-staging-*"
        Condition = {
          StringEquals = { "iam:PassedToService" = "ec2.amazonaws.com" }
        }
      }
    ]
  })
}

output "github_actions_staging_role_arn" {
  description = "IAM role ARN for the staging-infra workflow's aws-actions/configure-aws-credentials step"
  value       = aws_iam_role.github_actions_staging.arn
}
