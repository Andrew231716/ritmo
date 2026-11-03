const ALLOWED_HOSTS = new Set([
  's3.audio.com',
  'audio.com',
  'cdn.audio.com',
  'media.audio.com',
])

function hostAllowed(raw) {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    if (ALLOWED_HOSTS.has(host)) return true
    return host.endsWith('.audio.com') || host.endsWith('.amazonaws.com')
  } catch {
    return false
  }
}

/** Stream/redirect official Audio.com play URL for in-app preview only. */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const url = typeof req.query.url === 'string' ? req.query.url : ''
    if (!url || !hostAllowed(url)) {
      return res.status(400).json({ error: 'URL anteprima non valido' })
    }
    // Redirect to the official stream — browser <audio> follows it
    res.setHeader('Cache-Control', 'private, max-age=60')
    return res.redirect(302, url)
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
}
