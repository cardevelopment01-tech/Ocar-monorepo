# infra/terraform/observability/alerts-runtime.tf
#
# "Is something wrong with the API or its servers" alerts that the route-specific rules
# in alerts-static.tf don't cover: overall latency and errors, a server down, Node.js
# health (event loop lag), CPU, memory and OOM kills, scale-out falling behind, and
# queue backlog. Latency buckets in Grafana cover successful (2xx) requests only. Every expression reads a series Alloy already ships to Grafana, so
# these add NO active series. Same group layout as alerts-alloy.tf. Thresholds are
# starting points (the project latency target is p95 under 500 ms); tune from real data.
#
# no_data_state = "OK": an empty result is healthy here, and the pipeline-down case is
# covered by alerts-alloy.tf.
locals {
  runtime_rules = {
    "API p95 latency (all routes)" = {
      expr      = "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{__ENV__, route!~\"/health|/metrics\"}[5m])) by (le))"
      threshold = 0.5
      for       = "5m"
      severity  = "warning"
      summary   = "API p95 latency of successful requests above the 500 ms target for 5m"
    }
    "API p95 latency (critical)" = {
      expr      = "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{__ENV__, route!~\"/health|/metrics\"}[5m])) by (le))"
      threshold = 2
      for       = "5m"
      severity  = "critical"
      summary   = "API p95 latency of successful requests above 2s for 5m: users are waiting"
    }
    "API 5xx rate (all routes)" = {
      expr      = "sum(rate(http_request_duration_seconds_count{__ENV__, status_code=~\"5..\"}[5m])) / sum(rate(http_request_duration_seconds_count{__ENV__}[5m]))"
      threshold = 0.02
      for       = "5m"
      severity  = "warning"
      summary   = "More than 2% of API requests failed with a server error for 5m"
    }
    "API server down" = {
      expr      = "min(up{__ENV__, instance=\"api:4000\"})"
      threshold = 1
      invert    = true
      for       = "3m"
      severity  = "critical"
      summary   = "At least one API server stopped answering its metrics scrape for 3m"
    }
    "Node.js event loop lag" = {
      expr      = "max(nodejs_eventloop_lag_p99_seconds{__ENV__})"
      threshold = 0.25
      for       = "5m"
      severity  = "warning"
      summary   = "Node.js event loop p99 lag above 250 ms for 5m: a server is saturated and every request on it is slowing"
    }
    "Host CPU high" = {
      expr      = "100 - (avg by (host) (rate(node_cpu_seconds_total{__ENV__, mode=\"idle\"}[5m])) * 100)"
      threshold = 85
      for       = "10m"
      severity  = "warning"
      summary   = "A server's CPU has been above 85% for 10m. If the fleet is already at its maximum size this is a capacity problem"
    }
    "Host memory high" = {
      expr      = "100 * (1 - node_memory_MemAvailable_bytes{__ENV__} / node_memory_MemTotal_bytes{__ENV__})"
      threshold = 90
      for       = "5m"
      severity  = "warning"
      summary   = "A server has used more than 90% of its memory for 5m"
    }
    "Container OOM kill" = {
      expr      = "sum(increase(container_oom_events_total{__ENV__}[10m]))"
      threshold = 0
      for       = "1m"
      severity  = "critical"
      summary   = "A container was killed for running out of memory in the last 10m (its sockets were dropped)"
    }
    "Scale-out not keeping up" = {
      expr      = "avg(sum by (host) (rate(http_request_duration_seconds_count{__ENV__}[5m]))) * 60"
      threshold = 1500
      for       = "10m"
      severity  = "warning"
      summary   = "Requests per server per minute stayed above 1,500 for 10m (autoscale target is 1,000): scale-out is lagging or the fleet is at its maximum size"
    }
    "Database connections high" = {
      expr      = "sum(pg_pool_connections{__ENV__, state=\"total\"}) + (sum(pg_worker_pool_connections{__ENV__, state=\"total\"}) or vector(0)) + sum(pg_analytics_pool_connections{__ENV__, state=\"total\"})"
      threshold = 100
      for       = "5m"
      severity  = "warning"
      summary   = "The API holds more than 100 database connections across all servers (about 178 usable, 128 the most the pool caps allow with 8 servers): pools are close to saturating"
    }
    "Background job pool waiting" = {
      expr      = "max(pg_worker_pool_connections{__ENV__, state=\"waiting\"})"
      threshold = 3
      for       = "10m"
      severity  = "warning"
      summary   = "Background jobs have waited for a database connection for 10m: the worker pool cap is too low for the load"
    }
    "Queue backlog" = {
      expr      = "max(bullmq_queue_job_counts{__ENV__, queue=~\"dispatch|payments|notifications|push\", state=\"waiting\"})"
      threshold = 200
      for       = "5m"
      severity  = "warning"
      summary   = "More than 200 jobs waiting in the dispatch, payments, notifications or push queue for 5m: workers are not keeping up"
    }
  }
}

resource "grafana_rule_group" "runtime_health_stg" {
  name             = "ocar-runtime-health-stg"
  folder_uid       = grafana_folder.alerts.uid
  interval_seconds = 60

  dynamic "rule" {
    for_each = local.runtime_rules
    content {
      name      = "${rule.key} [stg]"
      condition = "C"
      for       = rule.value.for

      data {
        ref_id         = "A"
        datasource_uid = local.prometheus_datasource_uid
        relative_time_range {
          from = 900
          to   = 0
        }
        model = jsonencode({
          refId   = "A"
          instant = true
          expr    = replace(rule.value.expr, "__ENV__", local.alert_env.stg)
        })
      }

      data {
        ref_id         = "C"
        datasource_uid = "__expr__"
        relative_time_range {
          from = 0
          to   = 0
        }
        model = jsonencode({
          refId      = "C"
          type       = "threshold"
          expression = "A"
          conditions = [{ evaluator = { type = try(rule.value.invert, false) ? "lt" : "gt", params = [rule.value.threshold] } }]
        })
      }

      annotations = {
        summary     = rule.value.summary
        runbook_url = "https://github.com/cardevelopment01-tech/Ocar-monorepo/blob/main/docs/OPS_RUNBOOK.md"
      }
      labels         = { severity = rule.value.severity, env = "stg" }
      no_data_state  = "OK"
      exec_err_state = "Alerting"
    }
  }
}
