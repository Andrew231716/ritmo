import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import './App.css'

type MixMode = 'replace' | 'mix'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isVideoFile(file: File) {
  if (file.type.startsWith('video/')) return true
  return /\.(mp4|webm|mov|m4v|mkv|avi|3gp)$/i.test(file.name)
}

function isAudioFile(file: File) {
  if (file.type.startsWith('audio/')) return true
  return /\.(mp3|wav|m4a|aac|ogg|flac|wma|opus)$/i.test(file.name)
}

function extOf(name: string, fallback: string) {
  const i = name.lastIndexOf('.')
  if (i < 0) return fallback
  const ext = name.slice(i).toLowerCase()
  if (ext.length > 8) return fallback
  return ext
}

function toU8(data: string | Uint8Array): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="8" cy="16" r="3.2" fill="#F0B429" />
        <circle cx="16.5" cy="13.5" r="2.6" fill="#F0B429" opacity="0.85" />
        <path
          d="M11 4v12M16.5 5.5v8"
          stroke="#E8F2EF"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M11 4c3.2 1.2 5.5 2.2 5.5 1.2"
          stroke="#E8F2EF"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}

export default function App() {
  const ffmpegRef = useRef<FFmpeg | null>(null)
  const logsRef = useRef<string[]>([])
  const [ready, setReady] = useState(false)
  const [loadingEngine, setLoadingEngine] = useState(true)
  const [video, setVideo] = useState<File | null>(null)
  const [audio, setAudio] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [musicVolume, setMusicVolume] = useState(80)
  const [originalVolume, setOriginalVolume] = useState(30)
  const [mode, setMode] = useState<MixMode>('replace')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('Caricamento motore video…')
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<'video' | 'audio' | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const ffmpeg = new FFmpeg()
        ffmpegRef.current = ffmpeg
        logsRef.current = []

        ffmpeg.on('log', ({ message }) => {
          logsRef.current.push(message)
          if (logsRef.current.length > 80) logsRef.current.shift()
        })
        ffmpeg.on('progress', ({ progress: p }) => {
          if (!cancelled && Number.isFinite(p)) {
            setProgress(Math.min(99, Math.max(0, Math.round(p * 100))))
          }
        })

        const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm'
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        })

        if (!cancelled) {
          setReady(true)
          setLoadingEngine(false)
          setStatus('Pronto. Carica un video e una traccia audio.')
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setLoadingEngine(false)
          setReady(false)
          setError(
            'Motore video non disponibile. Apri in Chrome o Edge (su iPhone Safari a volte non funziona). Ricarica la pagina.',
          )
          setStatus('')
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!video) {
      setVideoUrl(null)
      return
    }
    const url = URL.createObjectURL(video)
    setVideoUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [video])

  useEffect(() => {
    return () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl)
    }
  }, [resultUrl])

  function pickFile(kind: 'video' | 'audio', file: File | undefined | null) {
    if (!file) return
    setError(null)
    setResultUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setProgress(0)

    if (kind === 'video') {
      if (!isVideoFile(file)) {
        setError('Seleziona un file video (mp4, webm, mov…).')
        return
      }
      setVideo(file)
      if (file.size > 80 * 1024 * 1024) {
        setStatus(
          `Video da ${formatBytes(file.size)}: l’elaborazione può richiedere diversi minuti e più memoria.`,
        )
      }
      return
    }

    if (!isAudioFile(file)) {
      setError('Seleziona un file audio (mp3, wav, m4a…). Non da Spotify.')
      return
    }
    setAudio(file)
  }

  function onDrop(kind: 'video' | 'audio', e: DragEvent) {
    e.preventDefault()
    setDragOver(null)
    pickFile(kind, e.dataTransfer.files?.[0])
  }

  async function runFfmpeg(args: string[]) {
    const ffmpeg = ffmpegRef.current
    if (!ffmpeg) throw new Error('Motore non pronto')
    logsRef.current = []
    const code = await ffmpeg.exec(args)
    if (code !== 0) {
      const tail = logsRef.current.slice(-12).join('\n')
      throw new Error(tail || `FFmpeg exit ${code}`)
    }
  }

  async function mix() {
    if (!video || !audio || !ffmpegRef.current || !ready || busy) return

    setBusy(true)
    setError(null)
    setProgress(1)
    setStatus('Preparazione file…')

    const ffmpeg = ffmpegRef.current
    const videoName = 'input_video' + extOf(video.name, '.mp4')
    const audioName = 'input_audio' + extOf(audio.name, '.mp3')
    const outName = 'output.mp4'
    const musicVol = Math.max(0.05, musicVolume / 100)
    const origVol = Math.max(0, originalVolume / 100)

    const cleanupNames = [videoName, audioName, outName]

    try {
      // Clear previous virtual FS leftovers
      for (const name of cleanupNames) {
        try {
          await ffmpeg.deleteFile(name)
        } catch {
          /* ok */
        }
      }

      setStatus('Caricamento file nel motore…')
      await ffmpeg.writeFile(videoName, await fetchFile(video))
      await ffmpeg.writeFile(audioName, await fetchFile(audio))
      setStatus(
        video.size > 80 * 1024 * 1024
          ? 'Unione in corso su video grande… attendi senza chiudere la pagina'
          : 'Unione in corso… può richiedere un minuto',
      )

      const audioOnlyReplace = [
        '-i',
        videoName,
        '-stream_loop',
        '-1',
        '-i',
        audioName,
        '-filter_complex',
        `[1:a]volume=${musicVol}[a]`,
        '-map',
        '0:v:0',
        '-map',
        '[a]',
      ] as const

      const audioMix = [
        '-i',
        videoName,
        '-stream_loop',
        '-1',
        '-i',
        audioName,
        '-filter_complex',
        `[0:a]volume=${origVol}[a0];[1:a]volume=${musicVol}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]`,
        '-map',
        '0:v:0',
        '-map',
        '[a]',
      ] as const

      const copyTail = [
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        '-shortest',
        outName,
      ]

      const encodeTail = [
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '28',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        '-shortest',
        outName,
      ]

      async function tryMix(base: readonly string[]) {
        // Fast path: keep original video stream (better for large phone videos)
        try {
          await runFfmpeg([...base, ...copyTail])
          return
        } catch {
          try {
            await ffmpeg.deleteFile(outName)
          } catch {
            /* ok */
          }
          setStatus('Ricodifica video… un po’ più lenta, attendi')
          await runFfmpeg([...base, ...encodeTail])
        }
      }

      if (mode === 'replace') {
        await tryMix(audioOnlyReplace)
      } else {
        try {
          await tryMix(audioMix)
        } catch {
          setStatus('Nessun audio nel video: uso solo la musica…')
          await tryMix(audioOnlyReplace)
        }
      }

      const data = await ffmpeg.readFile(outName)
      const bytes = toU8(data)
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      const blob = new Blob([copy], { type: 'video/mp4' })
      if (blob.size < 1000) {
        throw new Error('Output vuoto o troppo piccolo')
      }

      const url = URL.createObjectURL(blob)
      setResultUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })
      setProgress(100)
      setStatus('Fatto! Guarda l’anteprima e scarica l’MP4.')
    } catch (err) {
      console.error(err)
      const detail = err instanceof Error ? err.message : String(err)
      const hint = detail.includes('SharedArrayBuffer')
        ? 'Browser non supportato.'
        : 'Prova MP4 + MP3 più leggeri, oppure Chrome/Edge.'
      setError(`Elaborazione fallita. ${hint}`)
      setStatus('')
    } finally {
      for (const name of cleanupNames) {
        try {
          await ffmpeg.deleteFile(name)
        } catch {
          /* ignore */
        }
      }
      setBusy(false)
    }
  }

  const canMix = Boolean(video && audio && ready && !busy)

  let help = ''
  if (!ready && loadingEngine) help = 'Attendi: sto caricando il motore video…'
  else if (!ready) help = 'Motore non pronto: ricarica o usa Chrome/Edge.'
  else if (!video && !audio) help = 'Carica un video e un file audio (MP3/M4A), poi premi il pulsante.'
  else if (!video) help = 'Manca il video.'
  else if (!audio) help = 'Manca la musica (file audio sul telefono, non Spotify).'
  else if (busy) help = 'Elaborazione in corso…'

  return (
    <main className="app">
      <header>
        <div className="brand">
          <BrandMark />
          <h1 className="brand-name">Ritmo</h1>
        </div>
        <p className="tagline">
          Metti la tua musica su un video. Tutto resta sul tuo dispositivo: niente upload su
          server.
        </p>
      </header>

      <div className="workspace">
        <div className="drop-grid">
          <label
            className={`dropzone ${video ? 'has-file' : ''} ${dragOver === 'video' ? 'active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver('video')
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => onDrop('video', e)}
          >
            <p className="drop-label">1 · Video</p>
            <p className="drop-hint">Trascina o clicca · MP4, WebM, MOV</p>
            {video && (
              <div className="file-chip">
                <span>
                  {video.name} · {formatBytes(video.size)}
                </span>
              </div>
            )}
            <input
              type="file"
              accept="video/*,.mp4,.mov,.webm,.m4v"
              onChange={(e) => pickFile('video', e.target.files?.[0])}
            />
          </label>

          <label
            className={`dropzone ${audio ? 'has-file' : ''} ${dragOver === 'audio' ? 'active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver('audio')
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => onDrop('audio', e)}
          >
            <p className="drop-label">2 · Musica</p>
            <p className="drop-hint">File MP3 / WAV / M4A (non da Spotify)</p>
            {audio && (
              <div className="file-chip">
                <span>
                  {audio.name} · {formatBytes(audio.size)}
                </span>
              </div>
            )}
            <input
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
              onChange={(e) => pickFile('audio', e.target.files?.[0])}
            />
          </label>
        </div>

        {(videoUrl || resultUrl) && (
          <div className="preview">
            <video
              key={resultUrl ?? videoUrl ?? 'preview'}
              src={resultUrl ?? videoUrl ?? undefined}
              controls
              playsInline
            />
          </div>
        )}

        <section className="controls">
          <label className="toggle">
            <input
              type="checkbox"
              checked={mode === 'mix'}
              onChange={(e) => setMode(e.target.checked ? 'mix' : 'replace')}
            />
            Mantieni anche l’audio originale del video (mix)
          </label>

          <div className="control-row">
            <label>
              Volume musica <em>{musicVolume}%</em>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={musicVolume}
              onChange={(e) => setMusicVolume(Number(e.target.value))}
            />
          </div>

          {mode === 'mix' && (
            <div className="control-row">
              <label>
                Volume audio originale <em>{originalVolume}%</em>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={originalVolume}
                onChange={(e) => setOriginalVolume(Number(e.target.value))}
              />
            </div>
          )}

          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canMix}
              onClick={() => void mix()}
            >
              {busy && <span className="spinner" aria-hidden />}
              {busy ? 'Elaborazione…' : '3 · Metti la musica'}
            </button>
            {resultUrl && (
              <a className="btn btn-ghost" href={resultUrl} download="ritmo-video.mp4">
                Scarica MP4
              </a>
            )}
          </div>

          {(busy || progress > 0) && (
            <div className="progress" aria-hidden>
              <i style={{ width: `${Math.max(progress, busy ? 5 : 0)}%` }} />
            </div>
          )}

          <p className={`status ${error ? 'error' : ''}`}>
            {error ?? (help || status)}
          </p>
        </section>
      </div>

      <p className="footer">
        Elaborazione locale con FFmpeg · i file non lasciano il browser
      </p>
    </main>
  )
}
