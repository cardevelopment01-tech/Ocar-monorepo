# Lets GitHub Actions authenticate to AWS with short-lived tokens instead of
# static access keys stored as a repo secret -- the deploy job proves its
# identity via a signed OIDC token GitHub itself issues per workflow run.

data "tls_certificate" "github_actions" {
  url = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github_actions.certificates[0].sha1_fingerprint]
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
      Principal = { Federated = aws_iam_openid_connect_provider.github_actions.arn }
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
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:PutParameter"]
        Resource = local.image_tag_parameter_arn
      },
      {
        Effect = "Allow"
        Action = [
          "autoscaling:StartInstanceRefresh",
          "autoscaling:CancelInstanceRefresh",
        ]
        Resource = aws_autoscaling_group.api.arn
      },
      {
        # DescribeInstanceRefreshes doesn't support resource-level
        # permissions at all (confirmed via AWS's own IAM docs) -- scoping
        # it to the ASG ARN like the write actions above silently denies it
        # regardless of which resource is targeted. Confirmed via a real CI
        # failure after StartInstanceRefresh (correctly resource-scoped)
        # succeeded but the very next step's Describe call was denied.
        Effect   = "Allow"
        Action   = ["autoscaling:DescribeInstanceRefreshes"]
        Resource = "*"
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
      Principal = { Federated = aws_iam_openid_connect_provider.github_actions.arn }
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
        Resource = "${aws_s3_bucket.terraform_state.arn}/prod/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.terraform_state.arn
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
        Resource = aws_s3_bucket.terraform_state.arn
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
        Resource = aws_kms_key.terraform_state.arn
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
      Principal = { Federated = aws_iam_openid_connect_provider.github_actions.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:cardevelopment01-tech/Ocar-monorepo:ref:refs/heads/main"
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
        Resource = "${aws_s3_bucket.terraform_state.arn}/staging/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketPolicy", "s3:GetBucketVersioning"]
        Resource = aws_s3_bucket.terraform_state.arn
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:DescribeKey", "kms:GenerateDataKey"]
        Resource = aws_kms_key.terraform_state.arn
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
        # account. AttachRolePolicy/DetachRolePolicy are required for
        # aws_iam_role_policy_attachment.ssm_session_manager_debug (iam.tf).
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
