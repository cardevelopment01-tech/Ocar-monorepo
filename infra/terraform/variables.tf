# Inputs the rest of the .tf files reference as var.<name>. Anything that's
# the same for every environment gets a default here; anything that differs
# between prod and staging (environment) is left with no default so you're
# forced to pass it explicitly and can't accidentally apply against the
# wrong one.

variable "aws_region" {
  type        = string
  description = "AWS region everything gets created in"
  default     = "ap-south-1"
}

variable "environment" {
  type        = string
  description = "Deployment environment (prod, staging) -- no default, must be passed explicitly"
}

variable "project_name" {
  type        = string
  description = "Short project name, used as a prefix/tag on resources"
  default     = "ocar"
}

variable "domain_name" {
  type        = string
  description = "Domain the ALB serves, used for the ACM certificate"
  default     = "ocar-api.clienttesting.in"
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the VPC"
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  type        = list(string)
  description = "AZs to spread the public subnets across"
  default     = ["ap-south-1a", "ap-south-1b"]
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "CIDR block for each public subnet, index-matched to availability_zones"
  default     = ["10.0.0.0/24", "10.0.1.0/24"]
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type for the API fleet"
  default     = "t3.medium"
}

variable "api_port" {
  type        = number
  description = "Port the API container listens on (matches API_PORT in api/.env.example)"
  default     = 4000
}

variable "ssh_debug_cidr" {
  type        = string
  description = "CIDR allowed to SSH into instances for debugging, e.g. \"1.2.3.4/32\" -- null disables the rule entirely"
  default     = null
}

variable "ghcr_username" {
  type        = string
  description = "GHCR username used to docker login (matches ci-cd.yml)"
  default     = "cardevelopment01-tech"
}

variable "valkey_node_type" {
  type        = string
  description = "ElastiCache node type for the single Valkey node"
  default     = "cache.t4g.micro"
}
