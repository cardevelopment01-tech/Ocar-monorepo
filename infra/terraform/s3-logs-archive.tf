# Durable app-log archive, prod AND staging (unlike s3-metrics-archive.tf,
# which is a staging-only load-test scratch bucket). Alloy ships the api
# container's Pino JSON lines here (config.alloy's "s3_archive" pipeline) in
# parallel with Loki, so logs outlive Grafana Cloud's 14/30-day retention --
# 6 months, per the client's requirement. Loki stays the live-debugging path;
# this bucket is the long-term, SQL-queryable one (Athena, below).
#
# Layout: s3://<bucket>/logs/year=YYYY/month=MM/day=DD/hour=HH/<file>.gz
# (UTC, written by otelcol.exporter.awss3). Each object is gzip'd newline-
# delimited raw Pino JSON, one log line per row.
resource "aws_s3_bucket" "logs_archive" {
  bucket = "${var.project_name}-${var.environment}-logs-archive"

  # Staging is torn down after every load test -- a non-empty bucket would
  # block `terraform destroy`. Prod never auto-empties.
  force_destroy = var.environment != "prod"

  tags = {
    Name = "${var.project_name}-${var.environment}-logs-archive"
  }
}

# Dedicated key (same reasoning as metrics_archive's -- Trivy AWS-0132 wants a
# customer managed key, and it keeps the grant surface separate).
resource "aws_kms_key" "logs_archive" {
  description             = "${var.project_name}-${var.environment}-logs-archive bucket encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 7
}

resource "aws_kms_alias" "logs_archive" {
  name          = "alias/${var.project_name}-${var.environment}-logs-archive"
  target_key_id = aws_kms_key.logs_archive.key_id
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs_archive" {
  bucket = aws_s3_bucket.logs_archive.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.logs_archive.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "logs_archive" {
  bucket = aws_s3_bucket.logs_archive.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "logs_archive_tls_only" {
  bucket = aws_s3_bucket.logs_archive.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.logs_archive.arn, "${aws_s3_bucket.logs_archive.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

# 190 days = 6 months + a ~week of margin so "6 months" is never short by a
# day at the boundary. Standard storage on purpose: gzip'd logs at this volume
# cost cents, and Standard-IA's 128 KB minimum object size / 30-day minimum
# would cost more than it saves on 5-minute batch files.
resource "aws_s3_bucket_lifecycle_configuration" "logs_archive" {
  bucket = aws_s3_bucket.logs_archive.id

  rule {
    id     = "expire-logs-after-190-days"
    status = "Enabled"

    filter {
      prefix = "logs/"
    }

    expiration {
      days = 190
    }
  }

  # Postgres exporter metrics (config.alloy "postgres_s3"): OTLP JSON, written
  # instead of shipping to Grafana Cloud. 90 days is a starting point for
  # forensics, raise it if you want a longer history.
  rule {
    id     = "expire-metrics-after-90-days"
    status = "Enabled"

    filter {
      prefix = "metrics/"
    }

    expiration {
      days = 90
    }
  }

  # Athena query results are disposable.
  rule {
    id     = "expire-athena-results-after-7-days"
    status = "Enabled"

    filter {
      prefix = "_athena-results/"
    }

    expiration {
      days = 7
    }
  }

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# Write-only for the instance role: Alloy only ever PutObjects. Reading is
# done by humans via Athena under their own AWS identity, never by the fleet.
resource "aws_iam_role_policy" "logs_archive_write" {
  name = "${var.project_name}-${var.environment}-logs-archive-write"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:PutObject", "s3:AbortMultipartUpload"]
        Resource = [
          "${aws_s3_bucket.logs_archive.arn}/logs/*",
          "${aws_s3_bucket.logs_archive.arn}/metrics/*",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource = aws_kms_key.logs_archive.arn
      }
    ]
  })
}

# --- Query layer (Athena + Glue) ---------------------------------------------
# One string column ("line") holding the raw Pino JSON, queried with
# json_extract_scalar(line, '$.msg'). Deliberately NOT a JSON SerDe with a
# fixed column list: the log schema evolves with the app, and a schema-less
# table never needs a migration or breaks on a new field. Partition
# projection (year/month/day/hour computed from the path) means no crawler
# and no MSCK REPAIR -- new hours are queryable the moment they land.
resource "aws_glue_catalog_database" "logs" {
  name = "${replace(var.project_name, "-", "_")}_${var.environment}_logs"
}

resource "aws_glue_catalog_table" "app_logs" {
  name          = "app_logs"
  database_name = aws_glue_catalog_database.logs.name
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    EXTERNAL                    = "TRUE"
    "projection.enabled"        = "true"
    "projection.year.type"      = "integer"
    "projection.year.range"     = "2026,2035"
    "projection.month.type"     = "integer"
    "projection.month.range"    = "1,12"
    "projection.month.digits"   = "2"
    "projection.day.type"       = "integer"
    "projection.day.range"      = "1,31"
    "projection.day.digits"     = "2"
    "projection.hour.type"      = "integer"
    "projection.hour.range"     = "0,23"
    "projection.hour.digits"    = "2"
    "storage.location.template" = "s3://${aws_s3_bucket.logs_archive.bucket}/logs/year=$${year}/month=$${month}/day=$${day}/hour=$${hour}"
  }

  partition_keys {
    name = "year"
    type = "int"
  }
  partition_keys {
    name = "month"
    type = "int"
  }
  partition_keys {
    name = "day"
    type = "int"
  }
  partition_keys {
    name = "hour"
    type = "int"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.logs_archive.bucket}/logs/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe"
      parameters = {
        "serialization.format" = "1"
      }
    }

    columns {
      name = "line"
      type = "string"
    }
  }
}

# bytes_scanned_cutoff_per_query is the cost guard: Athena bills $5/TB
# scanned, and an unfiltered query over 6 months is the only way this layer
# ever costs real money. 10 GB cap = at most ~$0.05 per query, and a query
# that would exceed it is cancelled instead of billed.
resource "aws_athena_workgroup" "logs" {
  name = "${var.project_name}-${var.environment}-logs"

  configuration {
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = false
    bytes_scanned_cutoff_per_query     = 10737418240

    result_configuration {
      output_location = "s3://${aws_s3_bucket.logs_archive.bucket}/_athena-results/"

      encryption_configuration {
        encryption_option = "SSE_KMS"
        kms_key_arn       = aws_kms_key.logs_archive.arn
      }
    }
  }
}

# Starting points -- always filter on year/month/day (partition columns), or
# the query scans every object in the bucket.
resource "aws_athena_named_query" "errors_today" {
  name      = "app-logs-errors-today"
  workgroup = aws_athena_workgroup.logs.id
  database  = aws_glue_catalog_database.logs.name
  query     = <<-SQL
    SELECT json_extract_scalar(line, '$.time')      AS time,
           json_extract_scalar(line, '$.msg')       AS msg,
           json_extract_scalar(line, '$.requestId') AS request_id,
           line
    FROM app_logs
    WHERE year  = year(current_date)
      AND month = month(current_date)
      AND day   = day(current_date)
      AND TRY_CAST(json_extract_scalar(line, '$.level') AS integer) >= 50
    ORDER BY 1 DESC
    LIMIT 200
  SQL
}

resource "aws_athena_named_query" "by_request_id" {
  name      = "app-logs-by-request-id"
  workgroup = aws_athena_workgroup.logs.id
  database  = aws_glue_catalog_database.logs.name
  query     = <<-SQL
    -- Replace the date and the id. Keep the partition filters.
    SELECT json_extract_scalar(line, '$.time') AS time,
           json_extract_scalar(line, '$.msg')  AS msg,
           line
    FROM app_logs
    WHERE year = 2026 AND month = 10 AND day = 11
      AND json_extract_scalar(line, '$.requestId') = 'REPLACE-ME'
    ORDER BY 1
  SQL
}

# --- Metrics archive (config.alloy "metrics_s3") ---------------------------------
# One OTLP JSON document per object (single line), every scrape (api, node,
# postgres, cadvisor, alloy) unfiltered. Verified against real objects: Alloy's
# Prometheus receiver emits EVERY series as a gauge (counters included; the
# original type is in `metadata`), all label values are strings, time is
# timeUnixNano (string, ns). Query with the UNNEST chain in the named queries
# below; always filter on year/month/day (and hour) or you scan the whole prefix.
locals {
  otlp_attr = "struct<key:string,value:struct<stringvalue:string>>"
  otlp_dp   = "struct<attributes:array<${local.otlp_attr}>,timeunixnano:string,asdouble:double>"
}

resource "aws_glue_catalog_table" "app_metrics" {
  name          = "app_metrics"
  database_name = aws_glue_catalog_database.logs.name
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    EXTERNAL                    = "TRUE"
    "projection.enabled"        = "true"
    "projection.year.type"      = "integer"
    "projection.year.range"     = "2026,2035"
    "projection.month.type"     = "integer"
    "projection.month.range"    = "1,12"
    "projection.month.digits"   = "2"
    "projection.day.type"       = "integer"
    "projection.day.range"      = "1,31"
    "projection.day.digits"     = "2"
    "projection.hour.type"      = "integer"
    "projection.hour.range"     = "0,23"
    "projection.hour.digits"    = "2"
    "storage.location.template" = "s3://${aws_s3_bucket.logs_archive.bucket}/metrics/year=$${year}/month=$${month}/day=$${day}/hour=$${hour}"
  }

  partition_keys {
    name = "year"
    type = "int"
  }
  partition_keys {
    name = "month"
    type = "int"
  }
  partition_keys {
    name = "day"
    type = "int"
  }
  partition_keys {
    name = "hour"
    type = "int"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.logs_archive.bucket}/metrics/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.openx.data.jsonserde.JsonSerDe"
      parameters = {
        "ignore.malformed.json" = "true"
      }
    }

    columns {
      name = "resourcemetrics"
      type = "array<struct<scopemetrics:array<struct<metrics:array<struct<name:string,gauge:struct<datapoints:array<${local.otlp_dp}>>>>>>>>"
    }
  }
}

resource "aws_athena_named_query" "metric_over_time" {
  name      = "app-metrics-one-metric-over-time"
  workgroup = aws_athena_workgroup.logs.id
  database  = aws_glue_catalog_database.logs.name
  query     = <<-SQL
    -- One metric, one row per sample. Replace the date, hour and metric name.
    -- Keep the partition filters (year/month/day/hour) or the scan is the whole prefix.
    SELECT from_unixtime(CAST(dp.timeunixnano AS bigint) / 1e9) AS ts,
           element_at(filter(dp.attributes, a -> a.key = 'host'), 1).value.stringvalue AS host,
           dp.asdouble AS value
    FROM app_metrics
    CROSS JOIN UNNEST(resourcemetrics) AS r(rm)
    CROSS JOIN UNNEST(rm.scopemetrics) AS s(sm)
    CROSS JOIN UNNEST(sm.metrics) AS u(m)
    CROSS JOIN UNNEST(m.gauge.datapoints) AS v(dp)
    WHERE year = 2026 AND month = 10 AND day = 18 AND hour = 12
      AND m.name = 'node_load1'
    ORDER BY ts
    LIMIT 500
  SQL
}

resource "aws_athena_named_query" "series_per_host" {
  name      = "app-metrics-samples-per-metric-prefix-and-host"
  workgroup = aws_athena_workgroup.logs.id
  database  = aws_glue_catalog_database.logs.name
  query     = <<-SQL
    -- Which exporter produces how many samples per host in one hour (cardinality check).
    SELECT element_at(filter(dp.attributes, a -> a.key = 'host'), 1).value.stringvalue AS host,
           split_part(m.name, '_', 1) AS metric_prefix,
           count(*) AS samples
    FROM app_metrics
    CROSS JOIN UNNEST(resourcemetrics) AS r(rm)
    CROSS JOIN UNNEST(rm.scopemetrics) AS s(sm)
    CROSS JOIN UNNEST(sm.metrics) AS u(m)
    CROSS JOIN UNNEST(m.gauge.datapoints) AS v(dp)
    WHERE year = 2026 AND month = 10 AND day = 18 AND hour = 12
    GROUP BY 1, 2
    ORDER BY 3 DESC
  SQL
}

resource "aws_athena_named_query" "postgres_table_stat" {
  name      = "app-metrics-postgres-per-table"
  workgroup = aws_athena_workgroup.logs.id
  database  = aws_glue_catalog_database.logs.name
  query     = <<-SQL
    -- Postgres exporter (no longer in Grafana): sequential scans per table, newest
    -- sample per host. Every host scrapes the same database, so pick one host or dedupe.
    SELECT element_at(filter(dp.attributes, a -> a.key = 'relname'), 1).value.stringvalue AS tbl,
           max(dp.asdouble) AS seq_scan
    FROM app_metrics
    CROSS JOIN UNNEST(resourcemetrics) AS r(rm)
    CROSS JOIN UNNEST(rm.scopemetrics) AS s(sm)
    CROSS JOIN UNNEST(sm.metrics) AS u(m)
    CROSS JOIN UNNEST(m.gauge.datapoints) AS v(dp)
    WHERE year = 2026 AND month = 10 AND day = 18 AND hour = 12
      AND m.name = 'pg_stat_user_tables_seq_scan'
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 25
  SQL
}

# --- Human read access ---------------------------------------------------------
# Attach to the IAM user/group/role that should query logs (the fleet role is
# write-only on purpose). Read-only: Athena in THIS workgroup, the catalog
# table, the bucket, and the key.
resource "aws_iam_policy" "logs_archive_reader" {
  name = "${var.project_name}-${var.environment}-logs-archive-reader"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "athena:StartQueryExecution", "athena:StopQueryExecution",
          "athena:GetQueryExecution", "athena:GetQueryResults",
          "athena:GetWorkGroup", "athena:GetNamedQuery", "athena:ListNamedQueries",
          "athena:BatchGetNamedQuery"
        ]
        Resource = aws_athena_workgroup.logs.arn
      },
      {
        Effect = "Allow"
        Action = ["glue:GetDatabase", "glue:GetTable", "glue:GetPartitions"]
        Resource = [
          "arn:aws:glue:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:catalog",
          aws_glue_catalog_database.logs.arn,
          aws_glue_catalog_table.app_logs.arn,
          aws_glue_catalog_table.app_metrics.arn,
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"]
        Resource = [aws_s3_bucket.logs_archive.arn, "${aws_s3_bucket.logs_archive.arn}/*"]
      },
      {
        # Athena writes its result files here as the caller.
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:AbortMultipartUpload"]
        Resource = "${aws_s3_bucket.logs_archive.arn}/_athena-results/*"
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = aws_kms_key.logs_archive.arn
      }
    ]
  })
}

output "logs_archive_reader_policy_arn" {
  description = "Attach to whoever should query archived logs in Athena"
  value       = aws_iam_policy.logs_archive_reader.arn
}

output "logs_archive_athena_workgroup" {
  value = aws_athena_workgroup.logs.name
}
