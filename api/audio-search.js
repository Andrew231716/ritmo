export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
    const { token, query = '', page = 1 } = body
    if (!token) return res.status(401).json({ error: 'Token mancante' })

    const params = new URLSearchParams({
      query: String(query || ''),
      types: 'audio',
      page: String(Math.max(1, Number(page) || 1)),
    })

    const upstream = await fetch(`https://api.audio.com/v1/search?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })
    const data = await upstream.json().catch(() => ({}))
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: data.message || data.error || 'Ricerca Audio.com fallita',
      })
    }

    const results = (Array.isArray(data) ? data : [])
      .filter((row) => row && row.type === 'audio' && row.model)
      .map((row) => row.model)

    return res.status(200).json({ results })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
}
