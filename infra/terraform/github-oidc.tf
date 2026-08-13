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

# Scoped to exactly this repo, and only the main branch -- matches where the
# deploy job in ci-cd.yml already only runs (push to main), not every PR/branch.
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
          "token.actions.githubusercontent.com:sub" = "repo:cardevelopment01-tech/Ocar-monorepo:ref:refs/heads/main"
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
          "autoscaling:DescribeInstanceRefreshes",
          "autoscaling:CancelInstanceRefresh",
        ]
        Resource = aws_autoscaling_group.api.arn
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
