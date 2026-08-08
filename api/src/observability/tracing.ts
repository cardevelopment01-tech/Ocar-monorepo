import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'
import { config } from '@/config'
import { logger } from '@/lib/logger'

// Exported so the test above can assert on it without booting the SDK
// (booting it patches global modules — wrong thing to do in a unit test).
// enhancedDatabaseReporting:false is load-bearing, not a default to trust —
// enabled, it puts bound SQL parameter values (OTP hashes, phone numbers,
// tokens) into span attributes, bypassing the redaction Pino already does
// for logs. See docs/superpowers/specs/2026-08-08-observability-stack-design.md
// MUST-DO #4's security-boundary note.
export const pgInstrumentationConfig = { enhancedDatabaseReporting: false }

const sdk = new NodeSDK({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'ocar-api' }),
  traceExporter: new OTLPTraceExporter({
    url: `${process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://alloy:4318'}/v1/traces`,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-pg': pgInstrumentationConfig,
      // GPS-ping-hot-path noise — see MUST-DO #3's level-gate note, same
      // reasoning applies to trace volume as it does to log volume.
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
})

if (config.NODE_ENV !== 'test') {
  try {
    sdk.start()
  } catch (err) {
    logger.warn({ err }, 'failed to start OpenTelemetry SDK — continuing without tracing')
  }
}

export async function shutdownTracing(): Promise<void> {
  await sdk.shutdown()
}
