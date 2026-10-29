# Optional extra hostname served by the same ALB, with its own certificate -- used to test a stack on a name of its own
# while the main hostname (var.domain_name) still serves live traffic from another stack. Off unless
# var.test_domain_name is set, so it changes nothing for prod or staging.
#
# Like acm.tf, DNS is on Cloudflare: the validation CNAME below must be added by hand (DNS only, not proxied) before the
# apply can finish, and the hostname itself needs a CNAME to the ALB (output alb_dns_name).

resource "aws_acm_certificate" "test" {
  count = var.test_domain_name == null ? 0 : 1

  domain_name       = var.test_domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-test-cert"
  }
}

resource "aws_acm_certificate_validation" "test" {
  count = var.test_domain_name == null ? 0 : 1

  certificate_arn         = aws_acm_certificate.test[0].arn
  validation_record_fqdns = [for record in aws_acm_certificate.test[0].domain_validation_options : record.resource_record_name]
}

# Adds the certificate to the HTTPS listener next to the main one (SNI picks by hostname).
resource "aws_lb_listener_certificate" "test" {
  count = var.test_domain_name == null ? 0 : 1

  listener_arn    = aws_lb_listener.https.arn
  certificate_arn = aws_acm_certificate_validation.test[0].certificate_arn
}

output "test_acm_validation_record" {
  description = "CNAME to add in Cloudflare (DNS only) for var.test_domain_name's certificate -- null when no test hostname is set"
  value = var.test_domain_name == null ? null : {
    name  = tolist(aws_acm_certificate.test[0].domain_validation_options)[0].resource_record_name
    type  = tolist(aws_acm_certificate.test[0].domain_validation_options)[0].resource_record_type
    value = tolist(aws_acm_certificate.test[0].domain_validation_options)[0].resource_record_value
  }
}
