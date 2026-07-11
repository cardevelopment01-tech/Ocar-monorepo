import * as repo from './templates.repository'
import type { NotifChannel } from './notifications.repository'

export class MissingTemplateVariableError extends Error {
  constructor(slug: string, channel: string, missing: string[]) {
    super(`Template ${slug}/${channel} missing required variable(s): ${missing.join(', ')}`)
  }
}

export class TemplateNotFoundError extends Error {
  constructor(slug: string, channel: string) {
    super(`No active template for ${slug}/${channel}`)
  }
}

function substitute(text: string, context: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => context[key] ?? match)
}

export interface RenderedMessage {
  subject: string | null
  body: string
}

// Fetches the active template for (slug, channel, locale), validates the
// caller's context against variables_schema.required, then substitutes
// {{variable}} placeholders. Missing required variables throw rather than
// silently sending a mangled message to a real user.
export async function renderTemplate(
  slug: string,
  channel: NotifChannel,
  context: Record<string, string>,
  locale = 'en'
): Promise<RenderedMessage> {
  const template = await repo.getActiveTemplate(slug, channel, locale)
  if (!template) throw new TemplateNotFoundError(slug, channel)

  const missing = template.variablesSchema.required.filter(key => !(key in context))
  if (missing.length > 0) throw new MissingTemplateVariableError(slug, channel, missing)

  return {
    subject: template.subject ? substitute(template.subject, context) : null,
    body: substitute(template.body, context),
  }
}

export const listTemplates = repo.listTemplates
export const getTemplateById = repo.getTemplateById
export const updateTemplateContent = repo.updateTemplateContent
export const setTemplateActive = repo.setTemplateActive
