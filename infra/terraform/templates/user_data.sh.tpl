#!/bin/bash
# Boot script for a fresh EC2 instance: install Docker + Compose, pull the
# app image plus the observability sidecars (alloy, node_exporter) via the
# same docker-compose.prod.yml the old single-EC2 box uses (minus nginx --
# the ALB terminates TLS now, so it's never named in the `up` command below).
# Zero SSH required -- everything an instance needs to become healthy comes
# from IAM + SSM.
set -euxo pipefail
exec > >(tee /var/log/user-data.log) 2>&1

apt-get update -y
apt-get install -y docker.io curl
systemctl enable --now docker

# Ubuntu 24.04 dropped the `awscli` apt package -- install the official CLI
# v2 bundle instead (AWS's current recommended method for Linux).
apt-get install -y unzip
curl -sS "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp
/tmp/aws/install

# Ubuntu's own repos don't reliably carry a working Compose v2 plugin without
# adding Docker's official apt repo -- installing the official binary
# directly sidesteps that, same reasoning as the awscli fix above.
mkdir -p /usr/local/lib/docker/cli-plugins
curl -sSL "https://github.com/docker/compose/releases/download/v5.4.0/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

TOKEN=$(curl -sS -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
INSTANCE_ID=$(curl -sS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)

REGION="${region}"
IMAGE_TAG=$(aws ssm get-parameter --region "$REGION" --name "${image_tag_parameter_name}" --query 'Parameter.Value' --output text)

# set -x traces variable ASSIGNMENTS too, not just commands -- a plain
# `GHCR_TOKEN=$(...)` line would print the resolved secret value into
# /var/log/user-data.log once the substitution completes. Turn tracing off
# for the assignment itself, not just the later use of the variable.
set +x
GHCR_TOKEN=$(aws ssm get-parameter --region "$REGION" --name "${ghcr_token_parameter_name}" --with-decryption --query 'Parameter.Value' --output text)
set -x

mkdir -p /opt/ocar/infra/alloy
cd /opt/ocar

# .env.prod: injected into the api/alloy containers via docker-compose.prod.yml's
# own `env_file: .env.prod` -- filename matches exactly what that (unmodified)
# committed file already expects. ALLOY_HOSTNAME is unique per instance (that's
# the whole point -- see config.alloy's per-target host label); ALLOY_COLOR is
# the same for every instance in this launch template (blue or green, baked in
# at Terraform render time -- there's no runtime way to ask "which color am I"
# otherwise) and is what lets Grafana dashboards actually split by color during
# a deploy, matching the EC2 Color tag asg.tf already sets. Everything else in
# this file (DB/JWT/Redis creds, GRAFANA_CLOUD_* creds) is shared across
# instances and comes straight from the api-env parameter.
aws ssm get-parameter --region "$REGION" --name "${api_env_parameter_name}" --with-decryption --query 'Parameter.Value' --output text > .env.prod
{
  echo "ALLOY_HOSTNAME=$INSTANCE_ID"
  echo "ALLOY_ENV=${environment}"
  echo "ALLOY_COLOR=${color}"
} >> .env.prod

# .env: Compose's own auto-loaded substitution file (unrelated to env_file
# above) -- fills in docker-compose.prod.yml's $${GITHUB_REPOSITORY_OWNER}/
# $${IMAGE_TAG} references.
cat > .env <<EOF
GITHUB_REPOSITORY_OWNER=${ghcr_username}
IMAGE_TAG=$IMAGE_TAG
EOF

aws ssm get-parameter --region "$REGION" --name "${docker_compose_parameter_name}" --query 'Parameter.Value' --output text > docker-compose.prod.yml
aws ssm get-parameter --region "$REGION" --name "${alloy_config_parameter_name}" --query 'Parameter.Value' --output text > infra/alloy/config.alloy

# set -x would otherwise echo this command with $GHCR_TOKEN already expanded
# into /var/log/user-data.log -- turn tracing off for just this one line.
set +x
echo "$GHCR_TOKEN" | docker login ghcr.io -u "${ghcr_username}" --password-stdin
set -x

docker compose -f docker-compose.prod.yml pull api alloy node_exporter postgres_exporter cadvisor
docker compose -f docker-compose.prod.yml up -d api alloy node_exporter postgres_exporter cadvisor
