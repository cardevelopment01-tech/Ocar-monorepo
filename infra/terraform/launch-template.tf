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
  name_prefix   = "${var.project_name}-${var.environment}-"
  image_id      = data.aws_ami.ubuntu.id
  instance_type = var.instance_type

  vpc_security_group_ids = [aws_security_group.ec2.id]

  iam_instance_profile {
    name = aws_iam_instance_profile.ec2.name
  }

  metadata_options {
    http_tokens = "required" # IMDSv2 only
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
    image_tag_parameter_name      = local.image_tag_parameter_name
    ghcr_token_parameter_name     = local.ghcr_token_parameter_name
    api_env_parameter_name        = local.api_env_parameter_name
    docker_compose_parameter_name = aws_ssm_parameter.docker_compose_prod.name
    alloy_config_parameter_name   = aws_ssm_parameter.alloy_config.name
    ghcr_username                 = var.ghcr_username
  }))

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "${var.project_name}-${var.environment}-api"
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}
