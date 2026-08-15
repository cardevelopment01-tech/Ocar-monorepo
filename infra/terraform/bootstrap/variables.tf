# infra/terraform/bootstrap/variables.tf
#
# No `environment` variable here on purpose -- everything in this module is
# an account-wide singleton, not something that differs between prod and
# staging. That's the whole point of this module's existence.

variable "aws_region" {
  type        = string
  description = "AWS region everything gets created in"
  default     = "ap-south-1"
}

variable "project_name" {
  type        = string
  description = "Short project name, used as a prefix/tag on resources"
  default     = "ocar"
}
