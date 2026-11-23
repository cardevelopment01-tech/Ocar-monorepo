import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { config } from '@/config'
import { awsCredentials } from '@/lib/aws-credentials'

const ses = new SESv2Client({
  region: config.SES_REGION,
  ...awsCredentials(),
})

export interface EmailContent {
  /** Plain-text version: shown by clients that cannot display HTML, and a spam-filter signal in its own right. */
  text: string
  html?: string
  /** Where a reply goes (default: the sender address). */
  replyTo?: string
}

/** The sender is not set up, so the email could not be sent. Thrown instead of pretending, so the job fails visibly. */
export class EmailNotConfiguredError extends Error {
  constructor() {
    super('Email is not configured on this server (SES_FROM_EMAIL is empty), so nothing was sent.')
  }
}

export async function sendEmail(to: string, subject: string, content: string | EmailContent): Promise<void> {
  const { text, html, replyTo }: EmailContent = typeof content === 'string' ? { text: content } : content

  if (!config.SES_FROM_EMAIL) {
    // Local development, or an environment that opted in on purpose (ALLOW_DEV_EMAIL=true): print the email so the developer can read
    // the link in it. Anywhere else it must NOT be printed (the logs ship to Grafana Cloud and an invite link is a live credential) and
    // must NOT count as sent.
    if (config.NODE_ENV === 'development' || config.NODE_ENV === 'test' || config.ALLOW_DEV_EMAIL === 'true') {
      console.log('[EMAIL DEV]', to, subject, text)
      return
    }
    throw new EmailNotConfiguredError()
  }

  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: config.SES_FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: text, Charset: 'UTF-8' },
            ...(html ? { Html: { Data: html, Charset: 'UTF-8' } } : {}),
          },
        },
      },
    })
  )
}
