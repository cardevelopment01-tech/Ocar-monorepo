# ALB + target group + listeners. HTTPS terminates here using the ACM cert
# from acm.tf; HTTP just redirects to HTTPS. Target group health-checks
# /health -- same endpoint the current deploy pipeline already checks.

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
  name        = "${var.project_name}-${var.environment}-api-tg"
  port        = var.api_port
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "instance"

  health_check {
    path                = "/health"
    matcher             = "200"
    healthy_threshold   = 3
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 15
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-api-tg"
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
    target_group_arn = aws_lb_target_group.api.arn
  }
}

variable "maintenance_mode" {
  type        = bool
  description = "Set true to make the ALB serve a static maintenance response for every request, bypassing the target group entirely -- for use when the API fleet itself may be down (e.g. mid-instance-refresh) and the app-level Redis-backed maintenance flag can't run. Toggle with `terraform apply -var maintenance_mode=true`. Doesn't affect the target group's own /health check -- that's probed directly, not through listener rules."
  default     = false
}

# No effect on health checks: ELB health checks hit the target group's
# health_check block directly against each registered target, they don't
# route through listener rules at all -- so this rule can safely match every
# path without ever marking healthy instances as unhealthy.
resource "aws_lb_listener_rule" "maintenance" {
  count        = var.maintenance_mode ? 1 : 0
  listener_arn = aws_lb_listener.https.arn
  priority     = 1

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
