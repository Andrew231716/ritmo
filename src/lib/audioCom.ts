const CLIENT_ID = '1880828064262478'
const AUTH_URL = 'https://api.audio.com/auth/authorize'
const TOKEN_KEY = 'nastro-audiocom-token'
const REFRESH_KEY = 'nastro-audiocom-refresh'
const EXPIRES_KEY = 'nastro-audiocom-expires'
const VERIFIER_KEY = 'nastro-audiocom-verifier'
/** Refresh a bit before expiry so searches don't fail mid-session. */
const EXPIRY_SKEW_MS = 60_000

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

/** Persist auth across visits (localStorage). Migrate legacy sessionStorage once. */
function storeGet(key: string) {
  try {
    const fromLocal = localStorage.getItem(key)
    if (fromLocal) return fromLocal
    const fromSession = sessionStorage.getItem(key)
    if (fromSession) {
      localStorage.setItem(key, fromSession)
      sessionStorage.removeItem(key)
      return fromSession
    }
  } catch {
    /* private mode / blocked storage */
  }
  return null
}

function storeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
    sessionStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

function storeRemove(...keys: string[]) {
  for (const key of keys) {
    try {
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }
}

function saveTokenResponse(data: {
  access_token?: string
  refresh_token?: string
  expires_in?: number
}) {
  if (!data.access_token) throw new Error('Token Audio.com mancante')
  storeSet(TOKEN_KEY, data.access_token)
  if (data.refresh_token) storeSet(REFRESH_KEY, data.refresh_token)
  const expiresIn = Number(data.expires_in)
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    storeSet(EXPIRES_KEY, String(Date.now() + expiresIn * 1000))
  } else {
    // Unknown lifetime — keep access token; refresh when API returns 401.
    storeRemove(EXPIRES_KEY)
  }
}

export function getStoredToken() {
  return storeGet(TOKEN_KEY)
}

export function getStoredRefreshToken() {
  return storeGet(REFRESH_KEY)
}

export function isAudioComAuthed() {
  return Boolean(getStoredToken() || getStoredRefreshToken())
}

export function clearAudioComAuth() {
  storeRemove(TOKEN_KEY, REFRESH_KEY, EXPIRES_KEY, VERIFIER_KEY)
}

function tokenNeedsRefresh() {
  if (!getStoredToken()) return Boolean(getStoredRefreshToken())
  const raw = storeGet(EXPIRES_KEY)
  if (!raw) return false
  const expiresAt = Number(raw)
  if (!Number.isFinite(expiresAt)) return false
  return Date.now() >= expiresAt - EXPIRY_SKEW_MS
}

let refreshInFlight: Promise<string | null> | null = null

export async function refreshAudioComToken() {
  const refresh = getStoredRefreshToken()
  if (!refresh) return null
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    const res = await fetch('/api/audio-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refresh,
        client_id: CLIENT_ID,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      // Refresh rejected — force a new login.
      clearAudioComAuth()
      throw new Error(
        data.error || 'Sessione Audio.com scaduta: accedi di nuovo.',
      )
    }
    saveTokenResponse(data)
    return data.access_token as string
  })().finally(() => {
    refreshInFlight = null
  })

  return refreshInFlight
}

/** Return a usable access token, refreshing from localStorage when needed. */
export async function ensureAudioComToken() {
  if (tokenNeedsRefresh()) {
    const renewed = await refreshAudioComToken()
    if (renewed) return renewed
  }
  const token = getStoredToken()
  if (!token) throw new Error('Accedi ad Audio.com prima')
  return token
}

export async function beginAudioComLogin() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer)
  const challenge = b64url(await sha256(verifier))
  // localStorage survives the OAuth round-trip more reliably on mobile.
  storeSet(VERIFIER_KEY, verifier)
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
  const verifier = storeGet(VERIFIER_KEY)
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
  saveTokenResponse(data)
  storeRemove(VERIFIER_KEY)
  return data.access_token as string
}

async function searchWithToken(token: string, query: string, page: number) {
  return fetch('/api/audio-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, query, page }),
  })
}

export async function searchAudioCom(query: string, page = 1) {
  let token = await ensureAudioComToken()
  let res = await searchWithToken(token, query, page)
  if (res.status === 401 && getStoredRefreshToken()) {
    const renewed = await refreshAudioComToken()
    if (renewed) {
      token = renewed
      res = await searchWithToken(token, query, page)
    }
  }
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
  const safe = (track.title || 'audio-com').replace(/[^\w-]+/g, '_').slice(0, 40)
  return new File([blob], `${safe}.mp3`, { type: blob.type || 'audio/mpeg' })
}

export function trackPageUrl(track: AudioComTrack) {
  if (track.username && track.slug) {
    return `https://audio.com/${track.username}/audio/${track.slug}`
  }
  return `https://audio.com/search?q=${encodeURIComponent(track.title || '')}`
}

/** Official Audio.com stream URL (may be on S3 / CDN). */
export function trackPlayUrl(track: AudioComTrack) {
  const url = track.play?.url?.trim()
  return url || null
}

/** Same-origin proxy — fallback when the browser blocks the direct CDN URL (COEP). */
export function trackPreviewSrc(track: AudioComTrack) {
  const url = trackPlayUrl(track)
  if (!url) return null
  return `/api/audio-preview?url=${encodeURIComponent(url)}`
}
