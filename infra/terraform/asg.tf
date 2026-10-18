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

locals {
  asg_names = {
    for color in local.colors :
    color => color == "blue" ? "${var.project_name}-${var.environment}-asg" : "${var.project_name}-${var.environment}-asg-${color}"
  }
}

resource "aws_autoscaling_group" "api" {
  for_each = local.colors

  # "blue" keeps its exact pre-blue/green name ("ocar-prod-asg") -- name is
  # immutable on an ASG, so giving it the new "-blue" suffix here would
  # force-replace the live, traffic-serving ASG (a destroy-then-create
  # replacement, meaning a real capacity-to-zero window). "green" has no
  # such constraint (nothing exists yet) and uses the clean convention.
  # Asymmetric on purpose -- mirrored in deploy.yml's own name computation.
  name                = local.asg_names[each.key]
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

# Faster scale-out for a SUDDEN jump in load. The target tracking policy above is the steady-state controller, but its
# alarms are managed by AWS and cannot be tuned: in the 2026-10-17 load tests it raised the alarm 5.1 and 5.5 minutes
# after a fivefold jump, and the first extra server launched then. During those minutes one server carried two to
# three times its share (p95 up to 2.0 s, no errors). This step policy reacts to a single one-minute reading of
# requests per target above 1,500 (1.5x the tracking target). Measured live on 2026-10-18 (4 minutes of about 2,400
# requests/min): the alarm fired 3.1 minutes after the load began and the first extra server was healthy about 5.2
# minutes after it, against 5.1-5.5 and 7.5-8.5 minutes for target tracking alone. CloudWatch publishes a reading about
# 2 minutes after its minute ends (a replay of the recorded data that assumed 1 minute was optimistic). It only ADDS
# capacity. Target tracking keeps working on top of it: in that test it then added two more servers (to the maximum of 4)
# because its metric lagged while the first extra server was starting, and all of them scale in again by themselves, so
# a burst can cost a server or two for about half an hour (all gone 26 minutes after the burst ended). In the last five days of real data the metric reached 1,500 only
# in the two deliberate read bursts. Alarm-driven, so deploy.yml's "suspend AlarmNotification" on the idle color covers
# it too.
#
# The ASG is referenced by NAME (local.asg_names), not by resource, on purpose: a reference makes a targeted apply pull
# in the ASG and everything it depends on, and while Terraform and production disagree (database multi_az, machine
# image, parameter group; see tracker item 7) that would apply those unrelated changes too. Once the plan is clean,
# switch to aws_autoscaling_group.api[each.key].name. On a fresh environment the ASG must exist first: if the first
# apply says the group is not found, apply again.
#
# A CPU rule is deliberately not added: EC2 CPU is reported every 5 minutes (detailed monitoring is off), which would
# make it slower than the rule it would sit beside. Revisit after a realistic-mix load run (docs/OPS_RUNBOOK.md).
resource "aws_autoscaling_policy" "request_burst_step_out" {
  for_each = local.colors

  name                      = "${var.project_name}-${var.environment}-request-burst-${each.key}"
  autoscaling_group_name    = local.asg_names[each.key]
  policy_type               = "StepScaling"
  adjustment_type           = "ChangeInCapacity"
  metric_aggregation_type   = "Maximum"
  estimated_instance_warmup = 180 # a server is serving about 150 s after launch (2026-10-17 tests)

  # Intervals are measured from the alarm threshold (1,500): up to 2,500 adds one server, above that adds two.
  step_adjustment {
    metric_interval_lower_bound = 0
    metric_interval_upper_bound = 1000
    scaling_adjustment          = 1
  }
  step_adjustment {
    metric_interval_lower_bound = 1000
    scaling_adjustment          = 2
  }
}

resource "aws_cloudwatch_metric_alarm" "request_burst" {
  for_each = local.colors

  alarm_name          = "${var.project_name}-${var.environment}-request-burst-${each.key}"
  alarm_description   = "Requests per server above 1,500 in one minute: add capacity now instead of waiting for target tracking (see asg.tf)"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "RequestCountPerTarget"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 1500
  comparison_operator = "GreaterThanOrEqualToThreshold"
  # The idle color has no targets, so no data: that is not a breach.
  treat_missing_data = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
    TargetGroup  = aws_lb_target_group.api[each.key].arn_suffix
  }

  alarm_actions = [aws_autoscaling_policy.request_burst_step_out[each.key].arn]
}
