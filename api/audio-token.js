/**
 * OAuth token endpoint proxy for Audio.com.
 * Supports authorization_code (login) and refresh_token (keep session alive).
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
    const {
      code,
      code_verifier,
      redirect_uri,
      client_id,
      refresh_token,
      grant_type,
    } = body

    if (!client_id) {
      return res.status(400).json({ error: 'client_id mancante' })
    }

    const form = new URLSearchParams()
    form.set('client_id', String(client_id))

    if (grant_type === 'refresh_token' || (refresh_token && !code)) {
      if (!refresh_token) {
        return res.status(400).json({ error: 'refresh_token mancante' })
      }
      form.set('grant_type', 'refresh_token')
      form.set('refresh_token', String(refresh_token))
    } else {
      if (!code || !code_verifier || !redirect_uri) {
        return res.status(400).json({ error: 'Parametri OAuth mancanti' })
      }
      form.set('grant_type', 'authorization_code')
      form.set('code', String(code))
      form.set('redirect_uri', String(redirect_uri))
      form.set('code_verifier', String(code_verifier))
    }

    const upstream = await fetch('https://api.audio.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    })
    const data = await upstream.json().catch(() => ({}))
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error:
          data.error_description || data.message || data.error || 'Token exchange failed',
      })
    }
    return res.status(200).json(data)
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
}
