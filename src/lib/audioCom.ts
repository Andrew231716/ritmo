const CLIENT_ID = '1880828064262478'
const AUTH_URL = 'https://api.audio.com/auth/authorize'
const TOKEN_KEY = 'nastro-audiocom-token'
const REFRESH_KEY = 'nastro-audiocom-refresh'
const VERIFIER_KEY = 'nastro-audiocom-verifier'

export type AudioComTrack = {
  id: string
  title: string
  author_name?: string
  username?: string
  slug?: string
  license?: string
  is_downloadable?: boolean
  image?: string
  play?: { url?: string; duration?: number }
}

function redirectUri() {
  return `${window.location.origin}/audio-callback.html`
}

function b64url(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf)
  let s = ''
  bytes.forEach((b) => {
    s += String.fromCharCode(b)
  })
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(input: string) {
  const data = new TextEncoder().encode(input)
  return crypto.subtle.digest('SHA-256', data)
}

export function getStoredToken() {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function clearAudioComAuth() {
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(REFRESH_KEY)
  sessionStorage.removeItem(VERIFIER_KEY)
}

export async function beginAudioComLogin() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer)
  const challenge = b64url(await sha256(verifier))
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    scope: 'public',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  window.location.href = `${AUTH_URL}?${params}`
}

export async function finishAudioComLogin(code: string) {
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  if (!verifier) throw new Error('Sessione OAuth scaduta: riprova Accedi.')
  const res = await fetch('/api/audio-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri(),
      client_id: CLIENT_ID,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Login Audio.com fallito')
  sessionStorage.setItem(TOKEN_KEY, data.access_token)
  if (data.refresh_token) sessionStorage.setItem(REFRESH_KEY, data.refresh_token)
  sessionStorage.removeItem(VERIFIER_KEY)
  return data.access_token as string
}

export async function searchAudioCom(query: string, page = 1) {
  const token = getStoredToken()
  if (!token) throw new Error('Accedi ad Audio.com prima')
  const res = await fetch('/api/audio-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, query, page }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Ricerca fallita')
  return (data.results || []) as AudioComTrack[]
}

export function canImportTrack(track: AudioComTrack) {
  if (track.is_downloadable) return true
  const lic = (track.license || '').toLowerCase()
  return lic.startsWith('cc-') || lic === 'cc-0'
}

export async function importAudioComTrack(track: AudioComTrack) {
  if (!canImportTrack(track)) {
    throw new Error('Traccia non scaricabile / senza licenza libera')
  }
  const url = track.play?.url
  if (!url) throw new Error('URL audio non disponibile')
  const res = await fetch('/api/audio-fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      title: track.title,
      downloadable: Boolean(track.is_downloadable),
      license: track.license || '',
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Download fallito' }))
    throw new Error(err.error || 'Download fallito')
  }
  const blob = await res.blob()
  const safe = (track.title || 'audio-com').replace(/[^\w\-]+/g, '_').slice(0, 40)
  return new File([blob], `${safe}.mp3`, { type: blob.type || 'audio/mpeg' })
}

export function trackPageUrl(track: AudioComTrack) {
  if (track.username && track.slug) {
    return `https://audio.com/${track.username}/audio/${track.slug}`
  }
  return `https://audio.com/search?q=${encodeURIComponent(track.title || '')}`
}
