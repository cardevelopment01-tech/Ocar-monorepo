# Auto Scaling Group: the actual "automatic capacity + redundancy" the
# reviewer flagged as missing. References the launch template (step 6) and
# target group (step 7). Scales on ALB requests-per-target, not CPU, since
# that reacts to load before CPU saturates on a request-heavy API.

resource "aws_autoscaling_group" "api" {
  name                = "${var.project_name}-${var.environment}-asg"
  vpc_zone_identifier = aws_subnet.public[*].id
  target_group_arns   = [aws_lb_target_group.api.arn]

  min_size         = 2
  desired_capacity = 2
  max_size         = 4

  # "ELB" (not the default "EC2") means health is judged by the target
  # group's /health check, not just "is the instance running" -- an instance
  # whose Docker container crashed but the OS is still up would pass an EC2
  # health check and fail an ELB one.
  health_check_type = "ELB"
  # 60s was tuned for the original boot script (1 image pull, plain `docker
  # run`). The observability sidecars added real boot overhead -- installing
  # the Compose binary, pulling 2 more images, starting 3 containers instead
  # of 1 -- pushing actual time-to-healthy past 60s. Instances were passing
  # their own health checks fine but getting marked unhealthy and cycled by
  # the ASG before the grace period gave them a chance (confirmed directly:
  # a "failed" instance inspected mid-termination had all 3 containers
  # healthy, Alloy already shipping to Grafana Cloud, no errors anywhere).
  health_check_grace_period = 240

  # A literal "$Latest" string never changes value, so Terraform would never
  # see a diff on the ASG itself when the launch template updates -- and
  # instance_refresh only auto-triggers on a diff it detects here. Pointing
  # at the actual numeric version makes that diff real.
  launch_template {
    id      = aws_launch_template.api.id
    version = aws_launch_template.api.latest_version
  }

  # Without this, changing the launch template (new AMI, new instance type)
  # and re-applying does nothing to instances that are already running --
  # they'd sit on the old config until they happened to get replaced for some
  # other reason. This makes a launch template change trigger a rolling
  # replacement automatically.
  # min = max = 100 is specifically what makes AWS launch each replacement
  # instance BEFORE terminating the one it's replacing, one at a time --
  # per AWS's own docs, any other combination allows capacity to dip below
  # desired_capacity during the swap (e.g. min=50 lets it drop to 1-of-2
  # instances serving traffic). Slower than replacing several at once, but
  # this is what "zero-downtime" actually requires here.
  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 100
      max_healthy_percentage = 100
    }
  }

  # default_tags on the provider doesn't reach instances an ASG launches
  # (AWS creates those on the ASG's behalf, not Terraform directly) -- these
  # tag {} blocks are how ASG-launched instances actually get tagged.
  tag {
    key                 = "Name"
    value               = "${var.project_name}-${var.environment}-api"
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
}

resource "aws_autoscaling_policy" "request_count_tracking" {
  name                   = "${var.project_name}-${var.environment}-request-tracking"
  autoscaling_group_name = aws_autoscaling_group.api.name
  policy_type            = "TargetTrackingScaling"

  # ALBRequestCountPerTarget requires the ALB to actually be routing to the
  # target group already -- the arn_suffix references below only tell
  # Terraform the ALB/target group must exist, not that a listener has to be
  # attached first. Without this, it's a race: AWS rejects the policy if the
  # listener loses.
  depends_on = [aws_lb_listener.https]

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.main.arn_suffix}/${aws_lb_target_group.api.arn_suffix}"
    }

    # Requests per target per period -- a starting guess, not a measured
    # number. Retune once real traffic or the k6 load test (staging, out of
    # scope for this session) shows the actual per-instance capacity.
    target_value = 1000
  }
}
