# Auto Scaling Group: the actual "automatic capacity + redundancy" the
# reviewer flagged as missing. References the launch template (step 6) and
# target group (step 7). Scales on ALB requests-per-target, not CPU, since
# that reacts to load before CPU saturates on a request-heavy API.
#
# One ASG per color (blue/green) -- both exist all the time so the idle
# color is instantly available for the next deploy. min_size/desired_capacity
# below only seed the *active* color with a 1-instance floor on first apply
# (see var.active_color) -- every deploy after that flips both at runtime via
# `aws autoscaling update-auto-scaling-group` from
# .github/workflows/deploy.yml, not by re-applying Terraform (see
# lifecycle.ignore_changes below).
#
# Was min_size=2 (a redundancy floor -- without it, the request-count-tracking
# policy below is free to scale the live color down to 0, which happened for
# real during the blue/green migration and had to be fixed by hand on
# production). Deliberately dropped to 1 -- both prod and staging run a
# single instance minimum now, max_size=4 still gives the same scale-out
# ceiling under load. If a single-instance-down redundancy gap becomes a real
# problem again, that's the earlier incident repeating -- raise this back to
# 2, don't silently re-lower it.

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

  min_size         = each.key == var.active_color ? 1 : 0
  desired_capacity = each.key == var.active_color ? 1 : 0
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

  # min_size, desired_capacity, and suspended_processes are all flipped at
  # runtime by the deploy workflow as part of the blue/green cutover --
  # Terraform must not revert any of them on the next plan/apply, same
  # reasoning as the listener's default_action below in alb.tf.
  # suspended_processes specifically: the idle color's AlarmNotification
  # stays suspended indefinitely between deploys (steady-state, not just
  # mid-cutover) -- without ignoring it here, any unrelated apply (e.g. an
  # AMI bump) silently resumes it, discovered live while unpinning the
  # AMI pin from this same file.
  lifecycle {
    ignore_changes = [min_size, desired_capacity, suspended_processes]
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
