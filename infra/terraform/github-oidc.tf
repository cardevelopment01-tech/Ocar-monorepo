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

# Least privilege: only what the deploy job actually does -- update the
# image-tag parameter and trigger/monitor an ASG instance refresh. No EC2,
# no IAM, no broader SSM access.
resource "aws_iam_role_policy" "github_actions_deploy" {
  name = "${var.project_name}-${var.environment}-gha-deploy-policy"
  role = aws_iam_role.github_actions_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["ssm:GetParameter", "ssm:PutParameter"]
        Resource = concat(
          [for c in local.colors : local.image_tag_parameter_arns[c]],
          [local.active_color_parameter_arn]
        )
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
        Effect   = "Allow"
        Action   = ["elasticloadbalancing:DescribeTargetHealth", "elasticloadbalancing:DescribeTargetGroups"]
        Resource = [for c in local.colors : aws_lb_target_group.api[c].arn]
      },
      {
        # The one atomic cutover action -- flips the listener's default
        # target group from the old color to the new one, and back again on
        # a failed bake.
        Effect   = "Allow"
        Action   = ["elasticloadbalancing:ModifyListener", "elasticloadbalancing:DescribeListeners"]
        Resource = aws_lb_listener.https.arn
      },
      {
        # DescribeLoadBalancers doesn't support resource-level scoping.
        # Needed to resolve the ALB's own ARN before the listener lookup
        # above (the workflow only knows the ALB's name/DNS, not its ARN).
        Effect   = "Allow"
        Action   = ["elasticloadbalancing:DescribeLoadBalancers"]
        Resource = "*"
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
        Effect = "Allow"
        Action = ["ssm:SendCommand"]
        Resource = [
          "arn:aws:ssm:${data.aws_region.current.region}::document/AWS-RunShellScript",
          "arn:aws:ec2:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:instance/*",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:GetCommandInvocation"]
        Resource = "*"
      },
      {
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
        # launch template, ElastiCache, and ACM. Deliberate full-service
        # wildcards: unlike the narrower per-action lists on the plan/deploy
        # roles above (which only ever do a handful of specific things),
        # this role genuinely needs broad access to these 4 services since
        # this config exclusively manages them in this region/account, and
        # EC2/ELB/ASG/ElastiCache resources don't support useful ARN-based
        # scoping before the first apply creates them anyway.
        Effect = "Allow"
        Action = [
          "ec2:*Vpc*", "ec2:*Subnet*", "ec2:*RouteTable*", "ec2:*InternetGateway*",
          "ec2:*SecurityGroup*", "ec2:*LaunchTemplate*", "ec2:*Tags*",
          "ec2:Describe*",
          "elasticloadbalancing:*",
          "autoscaling:*",
          "elasticache:*",
          "acm:*",
        ]
        Resource = "*"
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
        # account.
        Effect = "Allow"
        Action = [
          "iam:GetRole", "iam:CreateRole", "iam:DeleteRole", "iam:TagRole",
          "iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy",
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
