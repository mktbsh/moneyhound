import { GOOGLE_DRIVE_SCOPE } from '@moneyhound/core'

const GIS_SRC = 'https://accounts.google.com/gsi/client'

export function googleClientId(): string {
  return (import.meta.env?.VITE_GOOGLE_CLIENT_ID ?? '').trim()
}

export function isGoogleConfigured(): boolean {
  return googleClientId().length > 0
}

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('gis_load_failed')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('gis_load_failed'))
    document.head.appendChild(script)
  })
}

export async function requestGoogleAccessToken(): Promise<string> {
  const clientId = googleClientId()
  if (!clientId) throw new Error('google_not_configured')
  await loadGis()
  const oauth = window.google?.accounts?.oauth2
  if (!oauth) throw new Error('gis_load_failed')
  return new Promise((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_DRIVE_SCOPE,
      callback: (response) => {
        if (!response.access_token || response.error) {
          reject(new Error(response.error || 'google_auth_failed'))
          return
        }
        const granted = response.scope ?? GOOGLE_DRIVE_SCOPE
        if (
          granted.includes('https://www.googleapis.com/auth/drive') &&
          !granted.split(' ').includes(GOOGLE_DRIVE_SCOPE)
        ) {
          reject(new Error('google_scope_rejected'))
          return
        }
        resolve(response.access_token)
      },
      error_callback: () => reject(new Error('google_auth_cancelled')),
    })
    client.requestAccessToken({ prompt: '' })
  })
}
