# infra/terraform/observability/cloudwatch-datasource.tf
#
# Lets the "ocar-overview" dashboard show RDS disk I/O (IOPS, latency, queue
# depth, EBS burst balance) -- those exist only in CloudWatch, not in Mimir.
#
# It is a live datasource (Grafana queries CloudWatch when a panel is open),
# so it adds zero Grafana Cloud active series. Cost is GetMetricData at
# ~$0.01 per 1,000 metrics requested while someone views the dashboard; keep
# dashboard refresh >= 1m and never build alert rules on this datasource
# (they would query CloudWatch every minute, all day).
#
# Auth is an access key for a read-only IAM user (chosen 2026-10-29 over
# Grafana Assume Role, which needs a manual external-ID step). The secret key
# lives in this module's S3 state and in Grafana; rotate it by tainting
# aws_iam_access_key.grafana_cloudwatch and re-applying.
resource "aws_iam_user" "grafana_cloudwatch" {
  name = "ocar-grafana-cloudwatch-read"
  tags = { Purpose = "grafana-cloud-cloudwatch-datasource" }
}

# Read-only. GetMetricData/ListMetrics have no resource-level scoping in IAM,
# so Resource is "*"; there is no write, no logs, no other service.
resource "aws_iam_user_policy" "grafana_cloudwatch" {
  name = "cloudwatch-read-metrics"
  user = aws_iam_user.grafana_cloudwatch.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "cloudwatch:GetMetricData",
        "cloudwatch:GetMetricStatistics",
        "cloudwatch:ListMetrics",
        "cloudwatch:DescribeAlarmsForMetric",
      ]
      Resource = "*"
    }]
  })
}

resource "aws_iam_access_key" "grafana_cloudwatch" {
  user = aws_iam_user.grafana_cloudwatch.name
}

resource "grafana_data_source" "cloudwatch" {
  type = "cloudwatch"
  name = "CloudWatch (AWS)"
  uid  = "ocar-cloudwatch"

  json_data_encoded = jsonencode({
    defaultRegion = "ap-south-1"
    authType      = "keys"
  })

  secure_json_data_encoded = jsonencode({
    accessKey = aws_iam_access_key.grafana_cloudwatch.id
    secretKey = aws_iam_access_key.grafana_cloudwatch.secret
  })
}
