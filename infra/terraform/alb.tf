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

  # Same "blue keeps its legacy name" reasoning as asg.tf's ASG -- target
  # group name is also immutable, and "ocar-prod-api-tg" is already live.
  name        = each.key == "blue" ? "${var.project_name}-${var.environment}-api-tg" : "${var.project_name}-${var.environment}-api-tg-${each.key}"
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
  # (see the design doc's section 3.3) -- this value bounds the blast
  # radius, it doesn't need to cover every ride.
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
