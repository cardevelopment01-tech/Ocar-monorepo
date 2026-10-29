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
  description = "Deployment environment -- no default, must be passed explicitly. prod = the current live stack (becomes the new staging once prd is live; keep the value, renaming would replace immutable resources). prd = the new production. staging = the old staging, to be deleted."

  validation {
    condition     = contains(["prod", "prd", "staging"], var.environment)
    error_message = "environment must be \"prod\", \"prd\" or \"staging\" -- a typo would silently skip local.protected's deletion protection."
  }
}

variable "project_name" {
  type        = string
  description = "Short project name, used as a prefix/tag on resources"
  default     = "ocar"
}

variable "domain_name" {
  type        = string
  description = "Domain the ALB serves, used for the ACM certificate"
  default     = "api.ocarindia.com"
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

variable "db_engine_version" {
  type        = string
  description = "RDS Postgres engine version -- matches the PG18 used in local Docker (aws rds describe-db-engine-versions confirmed 18.4 is available)"
  default     = "18.4"
}

variable "db_instance_class" {
  type        = string
  description = "RDS instance class -- t4g.small default gives ~225 max_connections, comfortable headroom over the ASG's current 100-connection peak (see docs on connection math)"
  default     = "db.t4g.medium"
}

variable "db_allocated_storage" {
  type        = number
  description = "Initial RDS storage in GB"
  default     = 100
}

variable "db_max_allocated_storage" {
  type        = number
  description = "RDS storage autoscaling ceiling in GB"
  default     = 500
}

variable "db_name" {
  type        = string
  description = "Default database name"
  default     = "ocar"
}

variable "db_master_username" {
  type        = string
  description = "RDS master username"
  default     = "ocar_admin"
}

variable "active_color" {
  type        = string
  description = "Which color's ASG starts at desired_capacity=1 and is the listener's initial default_action target -- only consulted on first apply / full recreate. Every deploy after that flips the live color via the deploy workflow's own active-color SSM parameter and a direct modify-listener call, never by re-applying Terraform with a different value here."
  default     = "blue"

  validation {
    condition     = contains(["blue", "green"], var.active_color)
    error_message = "active_color must be \"blue\" or \"green\"."
  }
}

variable "asg_cpu_target_percent" {
  type        = number
  description = "Average CPU % the ASG target-tracking policy holds each color at -- 19 matches the live prod policy"
  default     = 19
}

variable "db_multi_az" {
  type        = bool
  description = "Run a Multi-AZ standby for automatic failover -- false matches the live prod stack, prd sets true"
  default     = false
}

variable "db_snapshot_identifier" {
  type        = string
  description = "Snapshot to restore the database from on first creation (prd only) -- null creates an empty database. Ignored after creation, so it never rebuilds a live instance."
  default     = null
}
