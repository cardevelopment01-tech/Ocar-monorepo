# Values worth surfacing after apply, beyond alb_dns_name (alb.tf) and
# acm_validation_record (acm.tf). Nothing sensitive here -- no need for
# sensitive = true, none of these are secrets.

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "Public subnet IDs, index-matched to var.availability_zones"
  value       = aws_subnet.public[*].id
}

output "autoscaling_group_names" {
  description = "ASG name per color -- deploy.yml computes these itself by the same naming convention ($${var.project_name}-$${var.environment}-asg-<color>); this output is just for a human to sanity-check after apply"
  value       = { for c in local.colors : c => aws_autoscaling_group.api[c].name }
}

output "ec2_security_group_id" {
  description = "EC2 security group ID"
  value       = aws_security_group.ec2.id
}
