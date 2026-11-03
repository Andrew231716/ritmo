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

function canImport({ downloadable, license }) {
  if (downloadable) return true
  const lic = String(license || '').toLowerCase()
  return lic.startsWith('cc-') || lic === 'cc-0'
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { url, downloadable = false, license = '', title = 'audio' } = req.body || {}
    if (!url || !hostAllowed(url)) {
      return res.status(400).json({ error: 'URL audio non valido' })
    }
    if (!canImport({ downloadable, license })) {
      return res.status(403).json({
        error:
          'Import consentito solo se l’autore ha abilitato il download o con licenza Creative Commons',
      })
    }

    const upstream = await fetch(String(url), {
      headers: { Accept: 'audio/*,*/*' },
      redirect: 'follow',
    })
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'Download Audio.com fallito' })
    }

    const buf = Buffer.from(await upstream.arrayBuffer())
    if (buf.length < 1000) {
      return res.status(422).json({ error: 'File audio troppo piccolo o vuoto' })
    }
    if (buf.length > 40 * 1024 * 1024) {
      return res.status(413).json({ error: 'File troppo grande per il proxy (max 40 MB)' })
    }

    const type = upstream.headers.get('content-type') || 'audio/mpeg'
    res.setHeader('Content-Type', type)
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${String(title).replace(/[^\w\-]+/g, '_').slice(0, 40)}.mp3"`,
    )
    return res.status(200).send(buf)
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
}
