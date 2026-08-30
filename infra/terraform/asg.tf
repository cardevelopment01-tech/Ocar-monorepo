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

  # "blue" keeps its exact pre-blue/green name ("ocar-prod-asg") -- name is
  # immutable on an ASG, so giving it the new "-blue" suffix here would
  # force-replace the live, traffic-serving ASG (a destroy-then-create
  # replacement, meaning a real capacity-to-zero window). "green" has no
  # such constraint (nothing exists yet) and uses the clean convention.
  # Asymmetric on purpose -- mirrored in deploy.yml's own name computation.
  name                = each.key == "blue" ? "${var.project_name}-${var.environment}-asg" : "${var.project_name}-${var.environment}-asg-${each.key}"
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

  # Same "blue keeps its legacy name" reasoning as the ASG above --
  # scaling-policy name is also immutable.
  name                   = each.key == "blue" ? "${var.project_name}-${var.environment}-request-tracking" : "${var.project_name}-${var.environment}-request-tracking-${each.key}"
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
