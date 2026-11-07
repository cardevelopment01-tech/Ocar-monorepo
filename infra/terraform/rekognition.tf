# Driver identity verification (daily selfie + number plate check) calls AWS Rekognition from the api with the instance
# role's short-lived credentials, the same way it reaches S3 (see s3-documents.tf). The api hands Rekognition an S3 object
# reference, so the images never pass through the api process; the S3 read it needs is already granted by
# `documents_access`. Only these three image-analysis calls are allowed (face detect, face compare, text detect).
#
# Rekognition's image-analysis actions do not support resource-level permissions, so Resource must be "*". There is no
# collection, project or model involved: nothing is stored in Rekognition.
#
# The service reads the bucket in its own region (api config S3_REGION, default ap-south-1), which must match the
# Rekognition endpoint's region. Rollback: remove this file and apply; verification then fails open (drivers are never
# blocked by an AWS outage) and set `system_config.verification_mode` to `off`.
resource "aws_iam_role_policy" "rekognition_verification" {
  name = "${var.project_name}-${var.environment}-rekognition-verification"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["rekognition:DetectFaces", "rekognition:CompareFaces", "rekognition:DetectText"]
      Resource = "*"
    }]
  })
}
