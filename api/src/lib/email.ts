import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import nodemailer from 'nodemailer'
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
    super('Email is not configured on this server (EMAIL_FROM / SES_FROM_EMAIL is empty), so nothing was sent.')
  }
}

/** One sender address for either service; SES_FROM_EMAIL still works on its own, so an existing setup needs no change. */
const fromAddress = (): string => config.EMAIL_FROM || config.SES_FROM_EMAIL

// Created on first use, so a server that uses SES never builds it and a test can change the settings first.
let smtp: nodemailer.Transporter | null = null
function smtpTransport(): nodemailer.Transporter {
  smtp ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURITY === 'ssl', // port 465: TLS from the first byte
    // 'starttls': refuse to send at all if the server will not upgrade to TLS, rather than quietly falling back to plain text.
    requireTLS: config.SMTP_SECURITY === 'starttls',
    ignoreTLS: config.SMTP_SECURITY === 'none',
    ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS } } : {}),
    // Fail in seconds, not minutes: the job queue retries, and an invite is waited on by a person.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  return smtp
}

export async function sendEmail(to: string, subject: string, content: string | EmailContent): Promise<void> {
  const { text, html, replyTo }: EmailContent = typeof content === 'string' ? { text: content } : content

  const from = fromAddress()
  if (!from) {
    // Local development, or an environment that opted in on purpose (ALLOW_DEV_EMAIL=true): print the email so the developer can read
    // the link in it. Anywhere else it must NOT be printed (the logs ship to Grafana Cloud and an invite link is a live credential) and
    // must NOT count as sent.
    if (config.NODE_ENV === 'development' || config.NODE_ENV === 'test' || config.ALLOW_DEV_EMAIL === 'true') {
      console.log('[EMAIL DEV]', to, subject, text)
      return
    }
    throw new EmailNotConfiguredError()
  }

  if (config.EMAIL_PROVIDER === 'smtp') {
    await smtpTransport().sendMail({ from, to, subject, text, ...(html ? { html } : {}), ...(replyTo ? { replyTo } : {}) })
    return
  }

  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: from,
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
