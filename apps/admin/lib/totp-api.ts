import api from './api'

export const totpApi = {
  status: async (): Promise<{ totpEnabled: boolean; mandatory: boolean }> => {
    const { data } = await api.get('/api/v1/admin/totp/status')
    return data
  },

  setup: async (): Promise<{ secret: string; qrDataUrl: string }> => {
    const { data } = await api.post('/api/v1/admin/totp/setup')
    return data
  },

  confirm: async (code: string): Promise<{ recoveryCodes: string[] }> => {
    const { data } = await api.post('/api/v1/admin/totp/confirm', { code })
    return data
  },

  disable: async (password: string): Promise<void> => {
    await api.post('/api/v1/admin/totp/disable', { password })
  },
}
