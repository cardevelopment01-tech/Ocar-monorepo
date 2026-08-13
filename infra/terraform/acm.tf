# ACM certificate for the ALB. DNS is on Cloudflare, not Route 53, so
# Terraform can't create the validation CNAME itself -- it requests the cert,
# then aws_acm_certificate_validation blocks `apply` until it sees that CNAME
# show up in public DNS. You add that record in Cloudflare by hand using the
# acm_validation_record output below.
#
# This replaces the nginx + Let's Encrypt/certbot TLS setup on the old single
# EC2 box -- the ALB terminates TLS from here on, nginx no longer needs to.

resource "aws_acm_certificate" "main" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "${var.project_name}-cert"
  }
}

resource "aws_acm_certificate_validation" "main" {
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for record in aws_acm_certificate.main.domain_validation_options : record.resource_record_name]
}

output "acm_validation_record" {
  description = "CNAME record to add in Cloudflare (DNS only, not proxied) before apply can finish"
  value = {
    name  = tolist(aws_acm_certificate.main.domain_validation_options)[0].resource_record_name
    type  = tolist(aws_acm_certificate.main.domain_validation_options)[0].resource_record_type
    value = tolist(aws_acm_certificate.main.domain_validation_options)[0].resource_record_value
  }
}
