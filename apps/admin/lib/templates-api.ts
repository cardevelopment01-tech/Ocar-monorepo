import api from './api'

export interface NotificationTemplate {
  id: string
  slug: string
  name: string
  channel: 'sms' | 'push' | 'voice' | 'email' | 'whatsapp' | 'in_app'
  locale: string
  subject: string | null
  body: string
  variablesSchema: { required: string[]; optional: string[] }
  isActive: boolean
  version: number
  createdAt: string
  updatedAt: string
}

export const templatesApi = {
  list: async (): Promise<NotificationTemplate[]> => {
    const { data } = await api.get<{ templates: NotificationTemplate[] }>('/api/v1/admin/notification-templates')
    return data.templates
  },

  update: async (id: string, params: { subject: string | null; body: string }): Promise<NotificationTemplate> => {
    const { data } = await api.patch<{ template: NotificationTemplate }>(`/api/v1/admin/notification-templates/${id}`, params)
    return data.template
  },

  setActive: async (id: string, isActive: boolean): Promise<NotificationTemplate> => {
    const { data } = await api.patch<{ template: NotificationTemplate }>(`/api/v1/admin/notification-templates/${id}/active`, { isActive })
    return data.template
  },
}
