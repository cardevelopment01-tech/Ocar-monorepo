# infra/terraform/observability/outputs.tf

output "contact_point_uid" {
  description = "UID of the shared alert contact point -- referenced when adding new rule groups later"
  value       = grafana_contact_point.default.id
}
