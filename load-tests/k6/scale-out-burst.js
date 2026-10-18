// Bounded test of the fast scale-out policy (infra/terraform/asg.tf, aws_cloudwatch_metric_alarm.request_burst):
// about 2,400 requests per minute to one public read for 4 minutes. That is over the 1,500 alarm threshold and under the
// 2,500 that would add two servers. Reads only, no data written. Usage:
//   k6 run -e BASE_URL=https://<api host> load-tests/k6/scale-out-burst.js
// then watch the active color's scaling activities (docs/OPS_RUNBOOK.md, "Scale capacity"). A forced
// `aws cloudwatch set-alarm-state` does NOT work for a step policy, which needs a real metric value.
import http from 'k6/http'
import { check } from 'k6'

export const options = {
  scenarios: {
    burst: { executor: 'constant-arrival-rate', rate: 40, timeUnit: '1s', duration: '4m', preAllocatedVUs: 60, maxVUs: 150 },
  },
}

export default function () {
  const r = http.get(`${__ENV.BASE_URL}/api/v1/geo/cities`)
  check(r, { ok: (x) => x.status === 200 })
}
