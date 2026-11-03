const ALLOWED_HOSTS = new Set([
  's3.audio.com',
  'audio.com',
  'cdn.audio.com',
  'media.audio.com',
])

/** Cap preview bytes so Vercel response stays within limits (~2 MB ≈ 1–2 min MP3). */
const PREVIEW_MAX_BYTES = 2 * 1024 * 1024

function hostAllowed(raw) {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    if (ALLOWED_HOSTS.has(host)) return true
    return (
      host.endsWith('.audio.com') ||
      host.endsWith('.amazonaws.com') ||
      host.endsWith('.cloudfront.net') ||
      host.endsWith('.r2.dev')
    )
  } catch {
    return false
  }
}

async function fetchPreview(url) {
  // Prefer a ranged request (short clip). Some CDNs ignore Range — we still slice.
  const ranged = await fetch(String(url), {
    headers: {
      Accept: 'audio/*,*/*',
      Range: `bytes=0-${PREVIEW_MAX_BYTES - 1}`,
    },
    redirect: 'follow',
  })
  if (ranged.ok || ranged.status === 206) return ranged

  const full = await fetch(String(url), {
    headers: { Accept: 'audio/*,*/*' },
    redirect: 'follow',
  })
  return full
}

/**
 * Same-origin proxy for Audio.com stream URLs.
 * Used as fallback when the browser cannot play the CDN URL under COEP.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const url = typeof req.query.url === 'string' ? req.query.url : ''
    if (!url || !hostAllowed(url)) {
      return res.status(400).json({ error: 'URL anteprima non valido' })
    }

    const upstream = await fetchPreview(url)
    if (!(upstream.ok || upstream.status === 206)) {
      return res
        .status(upstream.status)
        .json({ error: 'Anteprima Audio.com non disponibile' })
    }

    const raw = Buffer.from(await upstream.arrayBuffer())
    const buf = raw.subarray(0, PREVIEW_MAX_BYTES)
    if (buf.length < 200) {
      return res.status(422).json({ error: 'Anteprima vuota' })
    }

    const type = upstream.headers.get('content-type') || 'audio/mpeg'
    res.setHeader('Content-Type', type.split(';')[0].trim() || 'audio/mpeg')
    res.setHeader('Cache-Control', 'private, max-age=120')
    res.setHeader('Accept-Ranges', 'none')
    return res.status(200).send(buf)
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
}
