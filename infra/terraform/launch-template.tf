# Launch Template: the "recipe" the Auto Scaling Group (step 8) uses to boot
# new instances -- AMI, instance type, security group, IAM instance profile,
# and the user_data boot script, all in one place.

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

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
    # Default hop limit (1) only reaches the host itself -- a container on
    # Docker's bridge network is one hop further away and can't reach IMDS to
    # inherit the instance's IAM role, which the api and postgres_exporter
    # containers (docker-compose.prod.yml) and the ad-hoc migration container
    # (deploy.yml) all now need for secretsmanager:GetSecretValue /
    # rds-db:connect. 2 is the standard value for "host + one container hop".
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
