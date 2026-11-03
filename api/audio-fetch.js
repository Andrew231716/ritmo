import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

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

function canImport({ downloadable, license }) {
  if (downloadable) return true
  const lic = String(license || '').toLowerCase()
  return lic.startsWith('cc-') || lic === 'cc-0'
}

/**
 * Stream the official Audio.com play URL to the browser.
 * Streaming avoids Vercel's ~4.5 MB buffered response limit so full tracks can import.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
    const { url, downloadable = false, license = '', title = 'audio' } = body
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
    if (!upstream.body) {
      return res.status(502).json({ error: 'Stream audio vuoto' })
    }

    const len = Number(upstream.headers.get('content-length') || 0)
    if (len > 0 && len < 1000) {
      return res.status(422).json({ error: 'File audio troppo piccolo o vuoto' })
    }
    if (len > 40 * 1024 * 1024) {
      return res.status(413).json({ error: 'File troppo grande (max 40 MB)' })
    }

    const type = (upstream.headers.get('content-type') || 'audio/mpeg').split(';')[0].trim()
    const filename = `${String(title).replace(/[^\w-]+/g, '_').slice(0, 40)}.mp3`
    res.statusCode = 200
    res.setHeader('Content-Type', type || 'audio/mpeg')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Cache-Control', 'private, max-age=60')
    if (len > 0) res.setHeader('Content-Length', String(len))

    const nodeStream = Readable.fromWeb(upstream.body)
    await pipeline(nodeStream, res)
  } catch (err) {
    if (res.headersSent) {
      try {
        res.destroy(err instanceof Error ? err : undefined)
      } catch {
        /* ignore */
      }
      return
    }
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
}
