import { config } from '@/config'

// Static keys when both are set (local dev, hosts without a role); otherwise nothing, so the AWS SDK falls back to its
// default credential chain -- on EC2 that is the instance role's short-lived, auto-rotating credentials. Spread into a
// client config: `credentials: undefined` is rejected by exactOptionalPropertyTypes.
export function awsCredentials() {
  return config.S3_ACCESS_KEY && config.S3_SECRET_KEY
    ? { credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY } }
    : {}
}
