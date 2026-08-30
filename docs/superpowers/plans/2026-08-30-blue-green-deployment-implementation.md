# Blue/Green Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rolling `instance_refresh` deploy with a blue/green ALB-listener-flip deploy — two parallel ASGs per environment, an atomic `ModifyListener` cutover, a bake window with instant rollback, per `docs/superpowers/specs/2026-08-28-blue-green-deployment-design.md`.

**Architecture:** `for_each`-convert the single ASG/target-group/launch-template into per-color (`blue`/`green`) pairs sharing one ALB/RDS/Valkey. Terraform owns the shape (both ASGs exist always, `min_size=0`); the GitHub Actions deploy workflow owns runtime state (which color is live, image tags, listener default) via AWS CLI calls, same division of responsibility the current single-ASG pipeline already uses for its `image-tag` SSM parameter.

**Tech Stack:** Terraform (AWS provider), GitHub Actions, AWS CLI (`aws elbv2`, `aws autoscaling`, `aws ssm`, `aws cloudwatch`).

**Fixes baked into this plan** (found during audit of the design spec against the live config, not in the original spec):
1. Target-tracking scaling policy would fight the deploy workflow's manual `desired_capacity` changes on the idle/bake-window color — fixed with explicit `SuspendProcesses`/`ResumeProcesses` calls around the deploy (Task 10).
2. `deregistration_delay` was never set explicitly, even though the bake-window "sockets drain naturally" story depends on it — made explicit with reasoning (Task 4).
3. The spec cites `ci-cd.yml`; the real file is `.github/workflows/deploy.yml` — this plan edits the real file (Task 10).
4. The new preview listener rule's priority was never reconciled against the existing `maintenance` rule — fixed by giving preview rules priority 1-2 and bumping maintenance to 3 (Task 4).
5. Converting existing singular resources (`aws_autoscaling_group.api`, etc.) to `for_each` addresses is a state-breaking change — a naive `terraform apply` would destroy and recreate the live ASG/target group/launch template, causing exactly the outage this feature exists to prevent. Fixed with explicit `terraform state mv` commands (Task 9), found during this plan's own drafting, not in the spec at all.

---

## Task 1: Shared color locals + `active_color` variable

**Files:**
- Modify: `infra/terraform/iam.tf:10-21`
- Modify: `infra/terraform/variables.tf` (append)

- [ ] **Step 1: Replace the single-param locals block with a per-color one**

In `infra/terraform/iam.tf`, replace lines 10-21 (the `locals` block) with:

```hcl
locals {
  colors = toset(["blue", "green"])

  image_tag_parameter_names = {
    for c in local.colors : c => "/${var.project_name}/${var.environment}/${c}/image-tag"
  }
  ghcr_token_parameter_name   = "/${var.project_name}/${var.environment}/ghcr-token"
  api_env_parameter_name      = "/${var.project_name}/${var.environment}/api-env"
  active_color_parameter_name = "/${var.project_name}/${var.environment}/active-color"

  ssm_parameter_arn_prefix = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter"
  image_tag_parameter_arns = {
    for c in local.colors : c => "${local.ssm_parameter_arn_prefix}${local.image_tag_parameter_names[c]}"
  }
  ghcr_token_parameter_arn    = "${local.ssm_parameter_arn_prefix}${local.ghcr_token_parameter_name}"
  api_env_parameter_arn       = "${local.ssm_parameter_arn_prefix}${local.api_env_parameter_name}"
  active_color_parameter_arn  = "${local.ssm_parameter_arn_prefix}${local.active_color_parameter_name}"

  ssm_kms_key_arn = "arn:aws:kms:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:alias/aws/ssm"
}
```

- [ ] **Step 2: Add the `active_color` variable**

Append to `infra/terraform/variables.tf`:

```hcl
variable "active_color" {
  type        = string
  description = "Which color's ASG starts at desired_capacity=2 and is the listener's initial default_action target -- only consulted on first apply / full recreate. Every deploy after that flips the live color via the deploy workflow's own active-color SSM parameter and a direct modify-listener call, never by re-applying Terraform with a different value here."
  default     = "blue"

  validation {
    condition     = contains(["blue", "green"], var.active_color)
    error_message = "active_color must be \"blue\" or \"green\"."
  }
}
```

- [ ] **Step 3: Verify**

Run: `cd infra/terraform && terraform fmt -check -diff && terraform validate`
Expected: no formatting diff, `Success! The configuration is valid.` (this step alone won't plan cleanly yet — `aws_iam_role_policy.read_boot_parameters` in Task 2 still references the old singular locals; validate only checks syntax/types, not references across not-yet-updated resources, so this should already pass since HCL references resolve lazily)

- [ ] **Step 4: Commit**

```bash
git add infra/terraform/iam.tf infra/terraform/variables.tf
git commit -m "infra: add per-color SSM parameter locals and active_color variable"
```

---

## Task 2: Per-color EC2 IAM policy + remove temporary debug access

**Files:**
- Modify: `infra/terraform/iam.tf:40-65` (read_boot_parameters policy)
- Modify: `infra/terraform/iam.tf:111-119` (remove ssm_session_manager_debug)

- [ ] **Step 1: Update the boot-parameters policy to cover both colors' image-tag params**

Replace the `aws_iam_role_policy.read_boot_parameters` resource body with:

```hcl
resource "aws_iam_role_policy" "read_boot_parameters" {
  name = "${var.project_name}-${var.environment}-read-boot-parameters"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["ssm:GetParameter"]
        Resource = concat(
          [for c in local.colors : local.image_tag_parameter_arns[c]],
          [
            local.ghcr_token_parameter_arn,
            local.api_env_parameter_arn,
            aws_ssm_parameter.docker_compose_prod.arn,
            aws_ssm_parameter.alloy_config.arn,
          ]
        )
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = local.ssm_kms_key_arn
      }
    ]
  })
}
```

- [ ] **Step 2: Remove the temporary SSM Session Manager debug attachment**

Delete this whole block from `iam.tf` (it was marked TEMPORARY/debug-only in its own comment and is broader than the app needs long-term):

```hcl
# TEMPORARY: debugging why targets are failing health checks -- lets us
# `aws ssm start-session` into an instance without opening SSH. Remove this
# attachment once the boot script is confirmed working; it's broader than
# the app needs long-term (adds Session Manager access on top of the scoped
# parameter-read policy above).
resource "aws_iam_role_policy_attachment" "ssm_session_manager_debug" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
```

Also remove its two references in `infra/terraform/github-oidc.tf`'s `github_actions_staging` policy (the `iam:AttachRolePolicy`/`iam:DetachRolePolicy` actions at lines ~364-366 were added specifically for this attachment — check whether anything else in the config still needs them before removing; if nothing else does, drop those two actions from that statement's `Action` list).

- [ ] **Step 3: Verify**

Run: `cd infra/terraform && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 4: Commit**

```bash
git add infra/terraform/iam.tf infra/terraform/github-oidc.tf
git commit -m "infra: scope EC2 boot-parameter IAM policy to both colors, drop temporary SSM debug access"
```

---

## Task 3: Per-color Launch Template

**Files:**
- Modify: `infra/terraform/launch-template.tf:20-71`

- [ ] **Step 1: Convert to `for_each`**

Replace the `aws_launch_template.api` resource with:

```hcl
resource "aws_launch_template" "api" {
  for_each = local.colors

  name_prefix   = "${var.project_name}-${var.environment}-${each.key}-"
  image_id      = data.aws_ami.ubuntu.id
  instance_type = var.instance_type

  vpc_security_group_ids = [aws_security_group.ec2.id]

  iam_instance_profile {
    name = aws_iam_instance_profile.ec2.name
  }

  metadata_options {
    http_tokens                 = "required" # IMDSv2 only
    http_put_response_hop_limit = 2
  }

  block_device_mappings {
    device_name = "/dev/sda1"
    ebs {
      volume_size = 20
      encrypted   = true
    }
  }

  user_data = base64encode(templatefile("${path.module}/templates/user_data.sh.tpl", {
    region                        = var.aws_region
    environment                   = var.environment
    image_tag_parameter_name      = local.image_tag_parameter_names[each.key]
    ghcr_token_parameter_name     = local.ghcr_token_parameter_name
    api_env_parameter_name        = local.api_env_parameter_name
    docker_compose_parameter_name = aws_ssm_parameter.docker_compose_prod.name
    alloy_config_parameter_name   = aws_ssm_parameter.alloy_config.name
    ghcr_username                 = var.ghcr_username
  }))

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name  = "${var.project_name}-${var.environment}-api-${each.key}"
      Color = each.key
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}
```

`templates/user_data.sh.tpl` needs no changes — `image_tag_parameter_name` is already an opaque template variable; each color's launch template now passes its own value.

- [ ] **Step 2: Verify**

Run: `cd infra/terraform && terraform validate`
Expected: `Success! The configuration is valid.` (still won't `plan` cleanly — `asg.tf` in Task 4 still references `aws_launch_template.api.id` as a singular resource)

- [ ] **Step 3: Commit**

```bash
git add infra/terraform/launch-template.tf
git commit -m "infra: convert launch template to per-color (blue/green)"
```

---

## Task 4: Per-color ASG + scaling policy

**Files:**
- Modify: `infra/terraform/asg.tf` (entire file)

- [ ] **Step 1: Convert both resources to `for_each`**

Replace the whole file content (keep the header comment) with:

```hcl
# Auto Scaling Group: the actual "automatic capacity + redundancy" the
# reviewer flagged as missing. References the launch template (step 6) and
# target group (step 7). Scales on ALB requests-per-target, not CPU, since
# that reacts to load before CPU saturates on a request-heavy API.
#
# One ASG per color (blue/green) -- both exist all the time so the idle
# color is instantly available for the next deploy. min_size is 0 for both
# so a bare `terraform apply` never fights the deploy workflow's runtime
# scaling; desired_capacity is only used to seed the *active* color with 2
# instances on first apply (see var.active_color) -- every deploy after
# that flips capacity via `aws autoscaling update-auto-scaling-group`
# from .github/workflows/deploy.yml, not by re-applying Terraform.

resource "aws_autoscaling_group" "api" {
  for_each = local.colors

  name                = "${var.project_name}-${var.environment}-asg-${each.key}"
  vpc_zone_identifier = aws_subnet.public[*].id
  target_group_arns   = [aws_lb_target_group.api[each.key].arn]

  min_size         = 0
  desired_capacity = each.key == var.active_color ? 2 : 0
  max_size         = 4

  # "ELB" (not the default "EC2") means health is judged by the target
  # group's /health check, not just "is the instance running".
  health_check_type = "ELB"
  # Tuned for the observability sidecars' boot overhead -- see git history
  # on this file for the incident that set this value; unchanged by the
  # blue/green split.
  health_check_grace_period = 240

  launch_template {
    id      = aws_launch_template.api[each.key].id
    version = aws_launch_template.api[each.key].latest_version
  }

  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 100
      max_healthy_percentage = 100
    }
  }

  tag {
    key                 = "Name"
    value               = "${var.project_name}-${var.environment}-api-${each.key}"
    propagate_at_launch = true
  }

  # Lets Grafana/Alloy dashboards split metrics by color during a deploy,
  # and lets you `aws ec2 describe-instances --filters Name=tag:Color,...`
  # when debugging which color an instance belongs to.
  tag {
    key                 = "Color"
    value               = each.key
    propagate_at_launch = true
  }

  tag {
    key                 = "Project"
    value               = "ocar"
    propagate_at_launch = true
  }

  tag {
    key                 = "Environment"
    value               = var.environment
    propagate_at_launch = true
  }

  tag {
    key                 = "ManagedBy"
    value               = "terraform"
    propagate_at_launch = true
  }

  # desired_capacity is flipped at runtime by the deploy workflow as part of
  # the blue/green cutover -- Terraform must not revert that on the next
  # plan/apply, same reasoning as the listener's default_action below in
  # alb.tf.
  lifecycle {
    ignore_changes = [desired_capacity]
  }
}

resource "aws_autoscaling_policy" "request_count_tracking" {
  for_each = local.colors

  name                   = "${var.project_name}-${var.environment}-request-tracking-${each.key}"
  autoscaling_group_name = aws_autoscaling_group.api[each.key].name
  policy_type            = "TargetTrackingScaling"

  depends_on = [aws_lb_listener.https]

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.main.arn_suffix}/${aws_lb_target_group.api[each.key].arn_suffix}"
    }

    target_value = 1000
  }
}
```

**Why this alone doesn't fully fix the scaling race:** this target-tracking policy still exists per-color and will still try to scale the idle color to 0 the moment it's brought up (near-zero request count pre-cutover), and will still try to scale the just-deactivated color down mid-bake (request count craters right after the listener flip even though its sockets are still open). Terraform can't conditionally disable a policy based on which color is "currently mid-deploy" — that's inherently a runtime concern. The actual fix is the deploy workflow explicitly suspending/resuming each ASG's `AlarmNotification` process around those windows — see Task 10, "Suspend the idle color's scaling policy" and "Resume scaling on the new active color, suspend it on the old one" steps. This task only builds the per-color shape; Task 10 is what makes it safe to actually run.

- [ ] **Step 2: Verify**

Run: `cd infra/terraform && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/terraform/asg.tf
git commit -m "infra: convert ASG and scaling policy to per-color (blue/green)"
```

---

## Task 5: Per-color ALB target groups, listener flip support, preview routing

**Files:**
- Modify: `infra/terraform/alb.tf` (entire file)

- [ ] **Step 1: Rewrite the file**

Replace the whole file content with:

```hcl
# ALB + target groups + listeners. HTTPS terminates here using the ACM cert
# from acm.tf; HTTP just redirects to HTTPS. Target group health-checks
# /health -- same endpoint the deploy pipeline already checks.
#
# One target group per color (blue/green) -- the listener's default_action
# forwards to whichever color is currently live; the deploy workflow flips
# that with a direct `aws elbv2 modify-listener` call at cutover, not
# through Terraform.

# Publicly exposed on purpose -- this is the internet-facing API load
# balancer, that's the whole point of it.
#trivy:ignore:AVD-AWS-0053
resource "aws_lb" "main" {
  name               = "${var.project_name}-${var.environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  # Mitigates HTTP request-smuggling/desync attacks -- off by default, should
  # always be on.
  drop_invalid_header_fields = true

  tags = {
    Name = "${var.project_name}-${var.environment}-alb"
  }
}

resource "aws_lb_target_group" "api" {
  for_each = local.colors

  name        = "${var.project_name}-${var.environment}-api-tg-${each.key}"
  port        = var.api_port
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "instance"

  # Bounds how long a target keeps existing (WebSocket) connections after
  # being deregistered before the ALB force-closes them -- this is what
  # makes "scale the old color to 0 after the bake window" graceful rather
  # than abrupt. Left at the AWS default (300s) rather than raised further:
  # a ride can run longer than any deregistration_delay we'd realistically
  # pick, so a socket that outlives this window gets closed and the
  # client's Socket.io library auto-reconnects onto the new color anyway
  # (see the design doc's ??3.3) -- this value bounds the blast radius, it
  # doesn't need to cover every ride.
  deregistration_delay = 300

  health_check {
    path                = "/health"
    matcher             = "200"
    healthy_threshold   = 3
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 15
  }

  tags = {
    Name  = "${var.project_name}-${var.environment}-api-tg-${each.key}"
    Color = each.key
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-Res-PQ-2025-09"
  certificate_arn   = aws_acm_certificate_validation.main.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api[var.active_color].arn
  }

  # The deploy workflow flips this listener's default target group with a
  # direct `aws elbv2 modify-listener` call at cutover -- Terraform must not
  # revert that on the next plan/apply, same reasoning as the ASG's
  # desired_capacity in asg.tf.
  lifecycle {
    ignore_changes = [default_action]
  }
}

# Header-based preview routing: `X-Deploy-Preview: blue`/`green` goes
# straight to that color's target group, bypassing whichever is the
# listener's current default -- this is how the deploy workflow smoke-tests
# the idle color through the real public ALB before it's ever live.
# Priority 1-2 (one rule per color) so preview routing always wins even
# when maintenance_mode is on (priority 3, below) -- lets ops validate or
# debug the idle color mid-incident instead of only ever seeing the
# maintenance page.
resource "aws_lb_listener_rule" "preview" {
  for_each     = local.colors
  listener_arn = aws_lb_listener.https.arn
  priority     = each.key == "blue" ? 1 : 2

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api[each.key].arn
  }

  condition {
    http_header {
      http_header_name = "X-Deploy-Preview"
      values           = [each.key]
    }
  }
}

variable "maintenance_mode" {
  type        = bool
  description = "Set true to make the ALB serve a static maintenance response for every request, bypassing the target groups entirely -- for use when the API fleet itself may be down (e.g. mid-deploy) and the app-level Redis-backed maintenance flag can't run. Toggle with `terraform apply -var maintenance_mode=true`. Doesn't affect the target groups' own /health checks -- those are probed directly, not through listener rules."
  default     = false
}

# No effect on health checks: ELB health checks hit each target group's
# health_check block directly against each registered target, they don't
# route through listener rules at all -- so this rule can safely match every
# path without ever marking healthy instances as unhealthy.
resource "aws_lb_listener_rule" "maintenance" {
  count        = var.maintenance_mode ? 1 : 0
  listener_arn = aws_lb_listener.https.arn
  priority     = 3 # was 1 -- bumped below the two preview rules above, see their comment

  action {
    type = "fixed-response"

    fixed_response {
      content_type = "application/json"
      status_code  = "503"
      message_body = jsonencode({
        error   = "Service is under maintenance"
        code    = "MAINTENANCE_MODE"
        message = "Ocar is briefly offline for maintenance. Please try again shortly."
      })
    }
  }

  condition {
    path_pattern {
      values = ["/*"]
    }
  }
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

output "alb_dns_name" {
  description = "ALB DNS name -- point Cloudflare's ocar-api CNAME here after cutover"
  value       = aws_lb.main.dns_name
}
```

- [ ] **Step 2: Verify**

Run: `cd infra/terraform && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/terraform/alb.tf
git commit -m "infra: convert ALB target groups to per-color, add preview listener rule, tune deregistration_delay"
```

---

## Task 6: Update outputs, extend the deploy role's IAM policy

**Files:**
- Modify: `infra/terraform/outputs.tf`
- Modify: `infra/terraform/github-oidc.tf:55-129` (`github_actions_deploy` policy)

- [ ] **Step 1: Replace the stale single-ASG output**

In `infra/terraform/outputs.tf`, replace:

```hcl
output "autoscaling_group_name" {
  description = "ASG name -- needed for the future deploy-api.yml change (start-instance-refresh)"
  value       = aws_autoscaling_group.api.name
}
```

with:

```hcl
output "autoscaling_group_names" {
  description = "ASG name per color -- deploy.yml computes these itself by the same naming convention (${var.project_name}-${var.environment}-asg-<color>); this output is just for a human to sanity-check after apply"
  value       = { for c in local.colors : c => aws_autoscaling_group.api[c].name }
}
```

- [ ] **Step 2: Rewrite the deploy role's policy for blue/green actions**

Replace the `aws_iam_role_policy.github_actions_deploy` resource's `policy` value (the whole `jsonencode({...})` block) with:

```hcl
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
```

This drops `autoscaling:StartInstanceRefresh` / `CancelInstanceRefresh` / `DescribeInstanceRefreshes` — the new workflow never calls them (blue/green replaces rolling refresh as the deploy mechanism entirely; instance refresh can still fire on its own from a real Terraform launch-template change, but that's driven by `terraform apply`, not this role).

- [ ] **Step 3: Verify**

Run: `cd infra/terraform && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 4: Commit**

```bash
git add infra/terraform/outputs.tf infra/terraform/github-oidc.tf
git commit -m "infra: scope deploy-role IAM policy for blue/green cutover actions"
```

---

## Task 7: Full `terraform plan` dry run (staging)

**Files:** none (verification only)

- [ ] **Step 1: Run a full plan against staging and read every line**

```bash
cd infra/terraform
terraform init -backend-config=staging.backend.hcl -reconfigure
terraform plan -var-file=staging.tfvars
```

Expected right now: **the plan will show destroys** for `aws_launch_template.api`, `aws_lb_target_group.api`, `aws_autoscaling_group.api`, `aws_autoscaling_policy.request_count_tracking` (the old singular addresses) alongside creates for the new `["blue"]`/`["green"]` addresses. **Do not apply this plan as-is** — that would tear down the live staging ASG/target group. Task 8 fixes this with `terraform state mv` before any apply happens. This step exists purely to confirm the *shape* of the diff matches expectations (right resource types, no unrelated changes) before doing the state surgery for real.

- [ ] **Step 2: Note down the exact resource addresses Terraform reports as destroy/create**

Copy the `# aws_launch_template.api will be destroyed` / `# aws_launch_template.api["blue"] will be created` style lines (and the equivalent for the other 3 resources) somewhere — Task 8 needs the exact addresses.

---

## Task 8: One-time state migration + SSM bootstrap (staging first, then prod)

**Files:** none (AWS/Terraform state operations only)

This is the step that makes the `for_each` conversion non-destructive. Skipping it turns Tasks 1-6 into an outage.

- [ ] **Step 1: Move existing resources into the `blue` slot of the new `for_each` addresses (staging)**

```bash
cd infra/terraform
terraform init -backend-config=staging.backend.hcl -reconfigure

terraform state mv 'aws_launch_template.api' 'aws_launch_template.api["blue"]'
terraform state mv 'aws_lb_target_group.api' 'aws_lb_target_group.api["blue"]'
terraform state mv 'aws_autoscaling_group.api' 'aws_autoscaling_group.api["blue"]'
terraform state mv 'aws_autoscaling_policy.request_count_tracking' 'aws_autoscaling_policy.request_count_tracking["blue"]'
```

Each command prints `Successfully moved 1 object(s).` — these are pure state-bookkeeping operations, nothing in AWS changes.

- [ ] **Step 2: Re-run plan and confirm it's now additive-only**

```bash
terraform plan -var-file=staging.tfvars
```

Expected: plan shows **creates only** for the `green` color's launch template/target group/ASG/scaling policy, plus the new `aws_lb_listener_rule.preview` (x2) and the `maintenance` rule's priority change (if `maintenance_mode` is currently true on staging — check `staging.tfvars`, it isn't set there so this rule doesn't exist yet, no diff). The `blue` resources should show **no changes** (or only benign attribute additions like the new `Color` tag) — if `blue` shows a destroy/recreate anywhere, stop and re-check the state-mv addresses before proceeding.

- [ ] **Step 3: Apply**

```bash
terraform apply -var-file=staging.tfvars
```

Confirm the plan shown matches step 2's output before typing `yes`.

- [ ] **Step 4: Seed the per-color SSM parameters (staging)**

The `green` color's launch template will fail to boot until its own image-tag parameter exists (nothing has ever written to it). Seed both colors with the currently-running image tag and create the `active-color` parameter:

```bash
CURRENT_TAG=$(aws ssm get-parameter --name /ocar/staging/image-tag --query 'Parameter.Value' --output text)
aws ssm put-parameter --name /ocar/staging/blue/image-tag --type String --value "$CURRENT_TAG"
aws ssm put-parameter --name /ocar/staging/green/image-tag --type String --value "$CURRENT_TAG"
aws ssm put-parameter --name /ocar/staging/active-color --type String --value "blue"
```

(The old shared `/ocar/staging/image-tag` parameter is now unused — leave it in place for now, delete it once Task 10's workflow has run successfully at least once, in case a fast rollback to the pre-blue/green pipeline is ever needed.)

- [ ] **Step 5: Confirm staging is healthy after the apply**

```bash
curl -sk -H "Host: staging.ocar-api.clienttesting.in" "https://$(terraform output -raw alb_dns_name)/health"
```

Expected: `200` with the same health payload as before this task started — the `blue` ASG never restarted, this whole task should be invisible to live traffic.

- [ ] **Step 6: Repeat steps 1-5 against prod**

Same commands, swapping `staging.backend.hcl`/`staging.tfvars`/`staging` for `prod.backend.hcl`/(no `-var-file`, prod uses defaults)/`prod`. **Do this only after Task 11 (staging validation) has passed** — see the ordering note at the top of Task 9.

- [ ] **Step 7: Commit**

Nothing to commit — this task is pure AWS/Terraform state operations, no file changes. If you want a record of it, note the commands run in the PR description for Task 10 instead.

---

## Task 9: Rewrite the deploy workflow for blue/green

**Files:**
- Modify: `.github/workflows/deploy.yml:128-346` (the entire `deploy` job)

**Do not run this against prod until Task 11 (staging validation) has passed at least 3 real deploys.** Test this whole job on staging first — either by temporarily pointing a copy of this workflow at staging, or (simpler, matches how `staging-infra.yml` is already a separate workflow) by adding a `workflow_dispatch` input to this same job during staging validation and reverting it before the prod rollout. Pick whichever is less churn when you get there; not decided here since it depends on how staging is wired for manual deploys at that point.

- [ ] **Step 1: Replace the `deploy` job**

Replace the entire `deploy:` job (lines 128-346) in `.github/workflows/deploy.yml` with:

```yaml
  deploy:
    name: Deploy to ASG (blue/green)
    needs: [changes, build-push]
    if: needs.changes.outputs.relevant == 'true'
    runs-on: ubuntu-latest
    environment: production
    concurrency:
      group: deploy-api
      cancel-in-progress: false
    permissions:
      id-token: write
      contents: read
      packages: read
    env:
      IMAGE_TAG: ${{ needs.build-push.outputs.image_tag }}
      PROJECT: ocar
      ENVIRONMENT: prod
      ACTIVE_COLOR_PARAM: /ocar/prod/active-color
      ALB_DNS_NAME: ${{ vars.ALB_DNS_NAME }}
      ALB_NAME: ocar-prod-alb
      BAKE_SECONDS: 600
      BAKE_POLL_INTERVAL: 30
      MAX_5XX_PER_POLL: 5
    steps:
      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: ${{ vars.GHA_DEPLOY_ROLE_ARN }}
          aws-region: ap-south-1

      - name: Read active color, compute idle color and resource names
        id: colors
        run: |
          set -e
          ACTIVE=$(aws ssm get-parameter --name "$ACTIVE_COLOR_PARAM" --query 'Parameter.Value' --output text)
          if [ "$ACTIVE" != "blue" ] && [ "$ACTIVE" != "green" ]; then
            echo "Unexpected active-color value: '$ACTIVE'" >&2
            exit 1
          fi
          if [ "$ACTIVE" = "blue" ]; then IDLE="green"; else IDLE="blue"; fi
          echo "active=$ACTIVE" >> "$GITHUB_OUTPUT"
          echo "idle=$IDLE" >> "$GITHUB_OUTPUT"
          echo "active_asg=${PROJECT}-${ENVIRONMENT}-asg-$ACTIVE" >> "$GITHUB_OUTPUT"
          echo "idle_asg=${PROJECT}-${ENVIRONMENT}-asg-$IDLE" >> "$GITHUB_OUTPUT"
          echo "idle_tg_name=${PROJECT}-${ENVIRONMENT}-api-tg-$IDLE" >> "$GITHUB_OUTPUT"
          echo "active_tg_name=${PROJECT}-${ENVIRONMENT}-api-tg-$ACTIVE" >> "$GITHUB_OUTPUT"
          echo "idle_image_tag_param=/${PROJECT}/${ENVIRONMENT}/$IDLE/image-tag" >> "$GITHUB_OUTPUT"
          echo "Active: $ACTIVE / Idle: $IDLE"

      - name: Find a running instance on the currently-active color (for migrations)
        id: instance
        run: |
          set -e
          ID=$(aws ec2 describe-instances \
            --filters "Name=tag:aws:autoscaling:groupName,Values=${{ steps.colors.outputs.active_asg }}" "Name=instance-state-name,Values=running" \
            --query 'Reservations[0].Instances[0].InstanceId' --output text)
          if [ -z "$ID" ] || [ "$ID" = "None" ]; then
            echo "No running instance on the active color (${{ steps.colors.outputs.active_asg }}) -- can't route the migration command anywhere" >&2
            exit 1
          fi
          echo "id=$ID" >> "$GITHUB_OUTPUT"

      - name: Run migrations (new image, current color still serving all traffic)
        env:
          DB_INSTANCE_ID: ocar-prod-db
          INSTANCE_ID: ${{ steps.instance.outputs.id }}
        run: |
          set -e
          DB_INFO=$(aws rds describe-db-instances --db-instance-identifier "$DB_INSTANCE_ID" \
            --query "DBInstances[0].{Host:Endpoint.Address,Port:Endpoint.Port,Name:DBName,User:MasterUsername,SecretArn:MasterUserSecret.SecretArn}" \
            --output json)
          DB_HOST=$(echo "$DB_INFO" | jq -r .Host)
          DB_PORT=$(echo "$DB_INFO" | jq -r .Port)
          DB_NAME=$(echo "$DB_INFO" | jq -r .Name)
          DB_USER=$(echo "$DB_INFO" | jq -r .User)
          DB_SECRET_ARN=$(echo "$DB_INFO" | jq -r .SecretArn)

          cat > /tmp/ssm-commands.json <<EOF
          {
            "commands": [
              "docker run --rm --pull always --name db_migrate -e DB_HOST=$DB_HOST -e DB_PORT=$DB_PORT -e DB_NAME=$DB_NAME -e DB_USER=$DB_USER -e DB_SECRET_ARN=$DB_SECRET_ARN -e AWS_REGION=$AWS_REGION --entrypoint node ghcr.io/${{ github.repository_owner }}/ocar-api:$IMAGE_TAG dist/db/migrate.js"
            ]
          }
          EOF

          CMD_ID=$(aws ssm send-command \
            --instance-ids "$INSTANCE_ID" \
            --document-name "AWS-RunShellScript" \
            --comment "ocar-api migration for $IMAGE_TAG" \
            --parameters file:///tmp/ssm-commands.json \
            --query 'Command.CommandId' --output text)

          for i in $(seq 1 30); do
            sleep 5
            STATUS=$(aws ssm get-command-invocation \
              --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
              --query 'Status' --output text 2>/dev/null || echo "Pending")
            case "$STATUS" in
              Success)
                echo "Migrations applied."
                exit 0 ;;
              Failed|Cancelled|TimedOut)
                echo "Migration command failed with status $STATUS" >&2
                aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
                  --query '{stdout:StandardOutputContent,stderr:StandardErrorContent}' --output json >&2
                exit 1 ;;
            esac
          done
          echo "Timed out waiting for migration command" >&2
          exit 1

      - name: Write new image tag to the idle color's own parameter only
        run: |
          aws ssm put-parameter --name "${{ steps.colors.outputs.idle_image_tag_param }}" --type String --value "$IMAGE_TAG" --overwrite

      - name: Suspend the idle color's scaling policy before waking it up
        run: |
          # Target-tracking scaling reacts to ALBRequestCountPerTarget, which
          # is near-zero for the idle color right up until cutover (only the
          # header-preview smoke test hits it). Without this, the policy
          # scales the idle color straight back down to min_size=0 seconds
          # after the next step sets desired_capacity=2, and the idle color
          # never actually comes up. Resumed on whichever color ends up
          # active after cutover, a few steps down.
          aws autoscaling suspend-processes --auto-scaling-group-name "${{ steps.colors.outputs.idle_asg }}" --scaling-processes AlarmNotification

      - name: Scale the idle color up
        run: |
          aws autoscaling update-auto-scaling-group --auto-scaling-group-name "${{ steps.colors.outputs.idle_asg }}" --min-size 0 --desired-capacity 2

      - name: Wait for the idle color's targets to pass health checks
        id: wait
        run: |
          set +e
          IDLE_TG_ARN=$(aws elbv2 describe-target-groups --names "${{ steps.colors.outputs.idle_tg_name }}" --query 'TargetGroups[0].TargetGroupArn' --output text)
          echo "idle_tg_arn=$IDLE_TG_ARN" >> "$GITHUB_OUTPUT"
          for i in $(seq 1 30); do
            HEALTHY=$(aws elbv2 describe-target-health --target-group-arn "$IDLE_TG_ARN" \
              --query "length(TargetHealthDescriptions[?TargetHealth.State=='healthy'])" --output text)
            echo "healthy targets: $HEALTHY/2"
            if [ "$HEALTHY" -ge 2 ] 2>/dev/null; then
              echo "result=success" >> "$GITHUB_OUTPUT"
              exit 0
            fi
            sleep 20
          done
          echo "result=failed" >> "$GITHUB_OUTPUT"

      - name: Smoke-test the idle color directly through the ALB (preview header)
        id: smoke
        if: steps.wait.outputs.result == 'success'
        run: |
          set +e
          for i in 1 2 3; do
            if curl -sk --max-time 5 -H "Host: ocar-api.clienttesting.in" -H "X-Deploy-Preview: ${{ steps.colors.outputs.idle }}" \
                 "https://$ALB_DNS_NAME/api/v1/geo/cities" | grep -q '"slug"'; then
              echo "result=success" >> "$GITHUB_OUTPUT"
              exit 0
            fi
            sleep 3
          done
          echo "result=failed" >> "$GITHUB_OUTPUT"

      - name: Roll back idle color on failed health-check/smoke-test (nothing user-facing ever changed)
        if: steps.wait.outputs.result != 'success' || steps.smoke.outputs.result != 'success'
        run: |
          echo "Idle color (${{ steps.colors.outputs.idle }}) failed to come up cleanly -- scaling it back down, active color was never touched." >&2
          aws autoscaling update-auto-scaling-group --auto-scaling-group-name "${{ steps.colors.outputs.idle_asg }}" --min-size 0 --desired-capacity 0
          exit 1

      - name: Flip the listener to the idle color
        id: flip
        if: steps.smoke.outputs.result == 'success'
        run: |
          set -e
          ALB_ARN=$(aws elbv2 describe-load-balancers --names "$ALB_NAME" --query 'LoadBalancers[0].LoadBalancerArn' --output text)
          LISTENER_ARN=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --query "Listeners[?Port==\`443\`].ListenerArn | [0]" --output text)
          aws elbv2 modify-listener --listener-arn "$LISTENER_ARN" \
            --default-actions "Type=forward,TargetGroupArn=${{ steps.wait.outputs.idle_tg_arn }}"
          aws ssm put-parameter --name "$ACTIVE_COLOR_PARAM" --type String --value "${{ steps.colors.outputs.idle }}" --overwrite
          echo "Listener flipped: ${{ steps.colors.outputs.active }} -> ${{ steps.colors.outputs.idle }} is now live."

      - name: Resume scaling on the new active color, suspend it on the old one
        if: steps.flip.conclusion == 'success'
        run: |
          # The color that just went live should scale normally with real
          # traffic again. The color that just went inactive must NOT let
          # its own target-tracking policy scale it down mid-bake -- it's
          # being kept warm on purpose for instant rollback (next step).
          aws autoscaling resume-processes --auto-scaling-group-name "${{ steps.colors.outputs.idle_asg }}" --scaling-processes AlarmNotification
          aws autoscaling suspend-processes --auto-scaling-group-name "${{ steps.colors.outputs.active_asg }}" --scaling-processes AlarmNotification

      - name: Bake period -- watch the new active color's error rate
        id: bake
        if: steps.flip.conclusion == 'success'
        run: |
          set +e
          ALB_ARN_SUFFIX=$(aws elbv2 describe-load-balancers --names "$ALB_NAME" --query 'LoadBalancers[0].LoadBalancerArn' --output text | sed 's#.*loadbalancer/##')
          IDLE_TG_ARN_SUFFIX=$(echo "${{ steps.wait.outputs.idle_tg_arn }}" | sed 's#.*targetgroup/##')
          ITERATIONS=$((BAKE_SECONDS / BAKE_POLL_INTERVAL))
          for i in $(seq 1 "$ITERATIONS"); do
            sleep "$BAKE_POLL_INTERVAL"
            END=$(date -u +%Y-%m-%dT%H:%M:%S)
            START=$(date -u -d "-${BAKE_POLL_INTERVAL} seconds" +%Y-%m-%dT%H:%M:%S)
            ERRORS=$(aws cloudwatch get-metric-statistics --namespace AWS/ApplicationELB \
              --metric-name HTTPCode_Target_5XX_Count \
              --dimensions Name=LoadBalancer,Value="$ALB_ARN_SUFFIX" Name=TargetGroup,Value="$IDLE_TG_ARN_SUFFIX" \
              --start-time "${START}Z" --end-time "${END}Z" --period "$BAKE_POLL_INTERVAL" --statistics Sum \
              --query 'Datapoints[0].Sum' --output text)
            [ "$ERRORS" = "None" ] && ERRORS=0
            ERRORS_INT=${ERRORS%.*}
            echo "bake check $i/$ITERATIONS: $ERRORS_INT 5xx in the last ${BAKE_POLL_INTERVAL}s"
            if [ "$ERRORS_INT" -gt "$MAX_5XX_PER_POLL" ] 2>/dev/null; then
              echo "result=failed" >> "$GITHUB_OUTPUT"
              exit 0
            fi
          done
          echo "result=success" >> "$GITHUB_OUTPUT"

      - name: Bake failed -- flip back to the old color instantly
        if: steps.flip.conclusion == 'success' && steps.bake.outputs.result == 'failed'
        run: |
          ALB_ARN=$(aws elbv2 describe-load-balancers --names "$ALB_NAME" --query 'LoadBalancers[0].LoadBalancerArn' --output text)
          LISTENER_ARN=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --query "Listeners[?Port==\`443\`].ListenerArn | [0]" --output text)
          OLD_TG_ARN=$(aws elbv2 describe-target-groups --names "${{ steps.colors.outputs.active_tg_name }}" --query 'TargetGroups[0].TargetGroupArn' --output text)
          aws elbv2 modify-listener --listener-arn "$LISTENER_ARN" --default-actions "Type=forward,TargetGroupArn=$OLD_TG_ARN"
          aws ssm put-parameter --name "$ACTIVE_COLOR_PARAM" --type String --value "${{ steps.colors.outputs.active }}" --overwrite
          # Swap the suspend/resume back too -- the pre-deploy color is live
          # again and should scale normally; the bad color goes back to
          # being kept warm-but-suspended in case someone wants to inspect
          # it before scaling it down by hand.
          aws autoscaling resume-processes --auto-scaling-group-name "${{ steps.colors.outputs.active_asg }}" --scaling-processes AlarmNotification
          echo "Rolled back to ${{ steps.colors.outputs.active }}. NOTE: any migrations $IMAGE_TAG applied are NOT reverted (forward-only) -- if the migration itself is the problem, fix forward, don't roll it back." >&2
          exit 1

      - name: Bake clean -- scale the old color down
        if: steps.flip.conclusion == 'success' && steps.bake.outputs.result == 'success'
        run: |
          aws autoscaling update-auto-scaling-group --auto-scaling-group-name "${{ steps.colors.outputs.active_asg }}" --min-size 0 --desired-capacity 0
          echo "Deploy complete. ${{ steps.colors.outputs.idle }} is live, ${{ steps.colors.outputs.active }} scaled to 0."
```

- [ ] **Step 2: Validate the YAML parses**

```bash
python -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))" && echo "YAML OK"
```

Expected: `YAML OK` (if `python`/`pyyaml` isn't available locally, skip this and rely on GitHub's own workflow-syntax check on the next push instead — it'll fail the run visibly rather than silently).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: rewrite deploy job for blue/green ALB listener-flip cutover"
```

---

## Task 10: Staging rollout validation

**Files:** none (operational verification)

Per the design spec's own rollout plan (??4) — do this before touching prod (Task 8 step 6, Task 9's prod rollout).

- [ ] **Step 1: Trigger a real deploy through the new pipeline against staging** and confirm: idle color scales up, passes health checks, smoke test passes via the preview header, listener flips, bake period runs its full `BAKE_SECONDS`, old color scales to 0. Watch the Actions log for each named step above to confirm it actually executed (not skipped).

- [ ] **Step 2: Trigger a second and third deploy**, confirming the color alternates blue -> green -> blue each time (check `/ocar/staging/active-color` in SSM after each).

- [ ] **Step 3: Deliberately break a deploy** (push a commit that makes `/health` return non-200, or a migration that fails) and confirm:
  - If it fails at the health-check/smoke-test stage: idle color scales back to 0, active color was never touched, no listener flip happened.
  - If it fails during the bake window (harder to trigger deliberately — could temporarily lower `MAX_5XX_PER_POLL` to 0 and let normal staging traffic noise trip it): listener flips back within one `BAKE_POLL_INTERVAL`, old color's `AlarmNotification` resumes, new (bad) color's stays suspended.

- [ ] **Step 4: Confirm Grafana/Alloy dashboards show the `Color` tag split** during one of the above deploys — both colors should be visible as separate series while both are running.

- [ ] **Step 5: Confirm a driver's Socket.io connection survives a deploy** — connect a test client, trigger a deploy, verify the client either stays connected throughout or disconnects/reconnects cleanly (check the browser/app console for reconnect events, not a hard error).

Only proceed to Task 8 step 6 (prod state migration) and a prod deploy once all 5 steps above pass.

---

## Task 11: Port to prod + update docs

**Files:**
- Modify: `CLAUDE.md` (CI/CD section)

- [ ] **Step 1: Run Task 8 step 6 against prod** (state mv + SSM seeding), per its ordering note.

- [ ] **Step 2: Merge/deploy Task 9's workflow change to `main`** and let the next real prod deploy exercise the new pipeline.

- [ ] **Step 3: Update `CLAUDE.md`'s CI/CD section**

Replace the `## CI/CD` section's deploy-behavior paragraph (the one starting "Deploy does: pull new image -> run migrations...") with:

```markdown
Deploy does blue/green: pull new image -> run migrations against the shared RDS instance (gates
cutover on migrations succeeding) -> scale the idle color's ASG up -> health-check + smoke-test the
idle color directly through the ALB via a preview header (`X-Deploy-Preview: blue`/`green`) -> flip
the ALB listener's default target group to the idle color (the one atomic cutover moment) -> bake
period watching `HTTPCode_Target_5XX_Count` on the new active color, with instant listener-flip
rollback if it trips -> scale the old color down to 0 once the bake is clean. Both colors' ASGs
exist in Terraform at all times (`min_size=0`); the deploy workflow (`.github/workflows/deploy.yml`,
triggered by `workflow_run` off `ci.yml`) owns which one is actually scaled up and live via the
`/ocar/{env}/active-color` and `/ocar/{env}/{color}/image-tag` SSM parameters -- Terraform never
touches those. See `docs/superpowers/specs/2026-08-28-blue-green-deployment-design.md` and
`docs/superpowers/plans/2026-08-30-blue-green-deployment-implementation.md` for the full design and
implementation history. Rollback (whether idle-stage failure or bake-window failure) does NOT revert
migrations (forward-only) -- a bad migration must be fixed forward, not rolled back.
```

(This also fixes the pre-existing doc drift where CLAUDE.md called this single file `ci-cd.yml` — it's actually two files, `ci.yml` + `deploy.yml`; the corrected text above names `deploy.yml` explicitly.)

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document blue/green deploy flow, fix ci-cd.yml naming drift"
```

---

## Self-Review Notes

- **Spec coverage:** ??1 (atomic listener flip, not DNS) -> Task 5. ??2 (expand/contract migration discipline) -> operational discipline, not code; called out in Task 9's migration step comment, no Terraform/workflow change needed. ??3 (architecture, two ASGs) -> Tasks 3-5. ??3.1 (Terraform changes table) -> Tasks 1-6. ??3.2 (deploy workflow steps 1-11) -> Task 9. ??3.3 (in-flight sockets) -> Task 5's `deregistration_delay` comment + Task 9's bake/suspend logic. ??4 (rollout plan) -> Tasks 8, 10, 11. ??5/??6 (cost/effort) -> informational, no task needed.
- **5 audit-found fixes**, all covered: #1 scaling race -> Task 9's suspend/resume steps. #2 deregistration_delay -> Task 5. #3 wrong filename -> Task 9 edits the real `deploy.yml`. #4 priority conflict -> Task 5. #5 state-mv safety -> Task 8.
- **Type/name consistency checked:** `steps.colors.outputs.*` names used in Task 9 match what's set via `echo "...=..." >> "$GITHUB_OUTPUT"` in the same job's first step. ASG/TG naming convention (`${project}-${environment}-{asg,api-tg}-${color}`) is identical across Tasks 3, 4, 5, and 9 — verified by re-reading each occurrence while writing this plan.
