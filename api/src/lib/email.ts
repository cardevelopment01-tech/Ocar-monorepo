import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { config } from '@/config'
import { awsCredentials } from '@/lib/aws-credentials'

const ses = new SESv2Client({
  region: config.SES_REGION,
  ...awsCredentials(),
})

export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  if (!config.SES_FROM_EMAIL) {
    console.log('[EMAIL DEV]', to, subject, body)
    return
  }

  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: config.SES_FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject },
          Body: { Text: { Data: body } },
        },
      },
    })
  )
}
