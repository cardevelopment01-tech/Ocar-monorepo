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

  tags = {
    Name = "${var.project_name}-${var.environment}-valkey"
  }
}

output "valkey_endpoint" {
  description = "Valkey host:port -- update REDIS_URL in the api-env SSM parameter to point here"
  value       = "${aws_elasticache_replication_group.valkey.primary_endpoint_address}:6379"
}
