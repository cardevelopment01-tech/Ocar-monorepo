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

output "autoscaling_group_name" {
  description = "ASG name -- needed for the future deploy-api.yml change (start-instance-refresh)"
  value       = aws_autoscaling_group.api.name
}

output "ec2_security_group_id" {
  description = "EC2 security group ID"
  value       = aws_security_group.ec2.id
}
