export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const s = Math.round(seconds)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

export function estimateCompressSeconds(fileSize: number, mobile: boolean) {
  // Rough heuristic: ~8–20 MB/min processed in-browser
  const mb = fileSize / (1024 * 1024)
  const rate = mobile ? 6 : 12
  return Math.max(20, Math.round((mb / rate) * 60))
}

export function isVideoFile(file: File) {
  if (file.type.startsWith('video/')) return true
  return /\.(mp4|webm|mov|m4v|mkv|avi|3gp)$/i.test(file.name)
}

export function isAudioFile(file: File) {
  if (file.type.startsWith('audio/')) return true
  return /\.(mp3|wav|m4a|aac|ogg|flac|wma|opus)$/i.test(file.name)
}

export function extOf(name: string, fallback: string) {
  const i = name.lastIndexOf('.')
  if (i < 0) return fallback
  const ext = name.slice(i).toLowerCase()
  if (ext.length > 8) return fallback
  return ext
}

export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

export function musicVideoLimitBytes() {
  return isMobileDevice() ? 45 * 1024 * 1024 : 180 * 1024 * 1024
}

export function yieldUI() {
  return new Promise<void>((resolve) => setTimeout(resolve, 40))
}

export function toU8(data: string | Uint8Array): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

export function blobFromU8(bytes: Uint8Array, type: string) {
  const view = new Uint8Array(bytes.byteLength)
  view.set(bytes)
  return new Blob([view], { type })
}

export async function requestWakeLock() {
  try {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> }
    }
    if (!nav.wakeLock) return null
    return await nav.wakeLock.request('screen')
  } catch {
    return null
  }
}

export function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const d = video.duration
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(d) ? d : 0)
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(0)
    }
    video.src = url
  })
}
