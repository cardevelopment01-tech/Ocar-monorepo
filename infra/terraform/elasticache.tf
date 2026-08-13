# Single ElastiCache Valkey node, replacing the external Redis Cloud
# instance -- fixes the "max number of clients reached" crash (Redis Cloud's
# free tier caps at 30 connections; ElastiCache supports thousands) and moves
# the cache inside the VPC (private IP, no internet hop) instead of an
# external SaaS reached over the public internet.
#
# ONE node, explicitly: num_cache_nodes = 1, plain aws_elasticache_cluster --
# not a replication group, not cluster-mode. No HA replica for now, matching
# the "sized honestly, not over-built" call made throughout this build; add
# a replica later if it's ever actually needed.

resource "aws_elasticache_subnet_group" "valkey" {
  name       = "${var.project_name}-${var.environment}-valkey-subnets"
  subnet_ids = aws_subnet.public[*].id
}

resource "aws_security_group" "valkey" {
  name        = "${var.project_name}-${var.environment}-valkey-sg"
  description = "Allow Valkey port only from the EC2 instances"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Valkey from EC2 instances"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2.id]
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-valkey-sg"
  }
}

# BullMQ requires maxmemory-policy = noeviction (job payloads must never be
# evicted under memory pressure) -- the default ElastiCache parameter group
# uses volatile-lru, which is the exact misconfiguration already seen in
# production logs on the current Redis Cloud instance. Fixing it here too.
resource "aws_elasticache_parameter_group" "valkey" {
  name   = "${var.project_name}-${var.environment}-valkey-params"
  family = "valkey8"

  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

# aws_elasticache_cluster (the single-node resource) doesn't support
# engine = "valkey" in the current provider -- aws_elasticache_replication_group
# does. num_cache_clusters = 1 + automatic_failover_enabled = false gets the
# same single-node outcome (one primary, zero replicas) through the resource
# type that actually supports Valkey.
resource "aws_elasticache_replication_group" "valkey" {
  replication_group_id       = "${var.project_name}-${var.environment}-valkey"
  description                = "Single-node Valkey cache for ${var.project_name} ${var.environment}"
  engine                     = "valkey"
  engine_version             = "8.0"
  node_type                  = var.valkey_node_type
  num_cache_clusters         = 1
  automatic_failover_enabled = false
  port                       = 6379
  parameter_group_name       = aws_elasticache_parameter_group.valkey.name
  subnet_group_name          = aws_elasticache_subnet_group.valkey.name
  security_group_ids         = [aws_security_group.valkey.id]

  # Both are creation-time-only settings on ElastiCache -- enabling them on
  # an already-live cluster forces Terraform to replace it (destroy +
  # recreate), not update in place. Acceptable: cache contents are disposable
  # (job queue state, sessions, OTP hashes), nothing here is a source of
  # truth. Traffic stays SG-restricted to only the EC2 instances either way;
  # this closes the gap for anyone with broader VPC-level visibility.
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  # AWS rejects a transit-encryption change without this -- it otherwise
  # defers to the next maintenance window, which isn't scheduled for this
  # cluster, so the change would silently never apply.
  apply_immediately = true
  # AWS's documented safe migration for converting an already-unencrypted
  # cluster: "preferred" accepts both rediss:// and redis:// while REDIS_URL
  # gets updated across instances, avoiding a hard cutover that breaks
  # every currently-connected client at once. Flip to "required" once
  # every instance is confirmed using rediss://.
  transit_encryption_mode = "preferred"

  tags = {
    Name = "${var.project_name}-${var.environment}-valkey"
  }
}

# Before transit encryption was enabled, this attribute returned a hostname
# (<name>.<suffix>.ng.0001.<region>.cache.amazonaws.com) that didn't match
# the TLS cert's SAN, throwing ERR_TLS_CERT_ALTNAME_INVALID -- confirmed
# directly against a live instance. AWS switched the reported endpoint to a
# "master."-prefixed, cert-matching format automatically once transit
# encryption was turned on, so this now just reads the attribute as-is.
output "valkey_endpoint" {
  description = "Valkey host:port (rediss://, TLS required) -- update REDIS_URL in the api-env SSM parameter to rediss://<this>:6379"
  value       = "${aws_elasticache_replication_group.valkey.primary_endpoint_address}:6379"
}
