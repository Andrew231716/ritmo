import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import './App.css'

type AppTab = 'compress' | 'music'
type MixMode = 'replace' | 'mix'
type QualityPreset = 'high' | 'balanced' | 'small'

type FpsOption = 'original' | '60' | '30' | '24' | '15'
type ResOption = 'original' | '1080' | '720' | '480'

const PRESETS: Record<
  QualityPreset,
  { label: string; hint: string; crf: number; preset: string }
> = {
  high: { label: 'Alta', hint: 'Ottima qualità, file più grande', crf: 18, preset: 'slow' },
  balanced: {
    label: 'Bilanciata',
    hint: 'Buona qualità, peso ragionevole',
    crf: 23,
    preset: 'medium',
  },
  small: { label: 'Compatta', hint: 'File più leggero, qualità ok', crf: 28, preset: 'veryfast' },
}

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

function isMobileDevice() {
  if (typeof navigator === 'undefined') return false
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

function yieldUI() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 40)
  })
}

/** Soft limit: phones kill the PWA when FFmpeg holds huge videos in RAM. */
function musicVideoLimitBytes() {
  return isMobileDevice() ? 45 * 1024 * 1024 : 180 * 1024 * 1024
}

function blobFromU8(bytes: Uint8Array, type: string) {
  // Avoid an extra full RAM copy when the underlying buffer is a plain ArrayBuffer
  const view = new Uint8Array(bytes.byteLength)
  view.set(bytes)
  return new Blob([view], { type })
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none">
        <rect
          x="3"
          y="5"
          width="18"
          height="14"
          rx="2.5"
          stroke="#E8F2EF"
          strokeWidth="1.8"
        />
        <path d="M3 8.5h18M3 15.5h18" stroke="#E8F2EF" strokeWidth="1.4" opacity="0.35" />
        <rect x="5.5" y="10" width="2.4" height="4" rx="0.5" fill="#F0B429" />
        <rect x="9.2" y="10" width="2.4" height="4" rx="0.5" fill="#F0B429" opacity="0.75" />
        <rect x="12.9" y="10" width="2.4" height="4" rx="0.5" fill="#F0B429" opacity="0.5" />
        <rect x="16.6" y="10" width="2.4" height="4" rx="0.5" fill="#F0B429" opacity="0.3" />
      </svg>
    </div>
  )
}

export default function App() {
  const ffmpegRef = useRef<FFmpeg | null>(null)
  const logsRef = useRef<string[]>([])
  const [ready, setReady] = useState(false)
  const [loadingEngine, setLoadingEngine] = useState(true)
  const [tab, setTab] = useState<AppTab>('compress')

  const [video, setVideo] = useState<File | null>(null)
  const [audio, setAudio] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [resultSize, setResultSize] = useState<number | null>(null)

  const [musicVolume, setMusicVolume] = useState(80)
  const [originalVolume, setOriginalVolume] = useState(30)
  const [mixMode, setMixMode] = useState<MixMode>('replace')

  const [quality, setQuality] = useState<QualityPreset>('balanced')
  const [fps, setFps] = useState<FpsOption>('original')
  const [resolution, setResolution] = useState<ResOption>('original')
  const [crfOverride, setCrfOverride] = useState<number | null>(null)

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('Caricamento motore video…')
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<'video' | 'audio' | null>(null)

  const effectiveCrf = crfOverride ?? PRESETS[quality].crf

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
          setStatus('Pronto. Scegli cosa fare e carica un video.')
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

  function clearResult() {
    setResultUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setResultSize(null)
    setProgress(0)
  }

  function pickFile(kind: 'video' | 'audio', file: File | undefined | null) {
    if (!file) return
    setError(null)
    clearResult()

    if (kind === 'video') {
      if (!isVideoFile(file)) {
        setError('Seleziona un file video (mp4, webm, mov…).')
        return
      }
      setVideo(file)
      if (file.size > 80 * 1024 * 1024) {
        setStatus(
          `Video da ${formatBytes(file.size)}: l’elaborazione può richiedere diversi minuti.`,
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

  async function finishOutput(outName: string, downloadName: string, purgeInputs: string[] = []) {
    const ffmpeg = ffmpegRef.current!
    // Free MEMFS inputs before reading output (critical on iPhone RAM)
    for (const name of purgeInputs) {
      try {
        await ffmpeg.deleteFile(name)
      } catch {
        /* ok */
      }
    }
    await yieldUI()

    const data = await ffmpeg.readFile(outName)
    const bytes = toU8(data)
    const blob = blobFromU8(bytes, 'video/mp4')
    if (blob.size < 1000) throw new Error('Output vuoto o troppo piccolo')

    try {
      await ffmpeg.deleteFile(outName)
    } catch {
      /* ok */
    }

    const url = URL.createObjectURL(blob)
    setResultUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return url
    })
    setResultSize(blob.size)
    setProgress(100)
    setStatus(`Fatto! Scarica «${downloadName}».`)
    return blob
  }

  async function compress() {
    if (!video || !ffmpegRef.current || !ready || busy) return

    setBusy(true)
    setError(null)
    setProgress(1)
    setStatus('Preparazione compressione…')

    const ffmpeg = ffmpegRef.current
    const videoName = 'input_video' + extOf(video.name, '.mp4')
    const outName = 'compressed.mp4'
    const { preset } = PRESETS[quality]
    const crf = effectiveCrf

    try {
      for (const name of [videoName, outName]) {
        try {
          await ffmpeg.deleteFile(name)
        } catch {
          /* ok */
        }
      }

      setStatus('Caricamento video…')
      await ffmpeg.writeFile(videoName, await fetchFile(video))
      setStatus('Compressione in corso… non chiudere la pagina')

      const filters: string[] = []
      if (resolution !== 'original') {
        filters.push(`scale=-2:${resolution}`)
      }
      if (fps !== 'original') {
        filters.push(`fps=${fps}`)
      }

      const args = ['-i', videoName]
      if (filters.length) {
        args.push('-vf', filters.join(','))
      }
      args.push(
        '-c:v',
        'libx264',
        '-preset',
        preset,
        '-crf',
        String(crf),
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        quality === 'high' ? '192k' : quality === 'balanced' ? '128k' : '96k',
        '-movflags',
        '+faststart',
        outName,
      )

      await runFfmpeg(args)
      const blob = await finishOutput(outName, 'nastro-compresso.mp4', [videoName])
      if (video.size > 0 && blob.size < video.size) {
        const saved = Math.round((1 - blob.size / video.size) * 100)
        setStatus(`Fatto! Circa ${saved}% più leggero. Scarica l’MP4.`)
      }
    } catch (err) {
      console.error(err)
      setError('Compressione fallita. Prova un preset più leggero o Chrome/Edge.')
      setStatus('')
    } finally {
      for (const name of [videoName, outName]) {
        try {
          await ffmpeg.deleteFile(name)
        } catch {
          /* ignore */
        }
      }
      setBusy(false)
    }
  }

  async function mixMusic() {
    if (!video || !audio || !ffmpegRef.current || !ready || busy) return

    const limit = musicVideoLimitBytes()
    if (video.size > limit) {
      setError(
        `Video troppo pesante per la musica su questo telefono (${formatBytes(video.size)}). Vai su Comprimi (720p / Compatta), scarica il file leggero, poi torna qui.`,
      )
      setStatus('')
      return
    }

    setBusy(true)
    setError(null)
    setProgress(1)
    setStatus('Preparazione file…')
    await yieldUI()

    const ffmpeg = ffmpegRef.current
    // Always remux to mp4 names — avoids weird MOV/HEVC path issues
    const videoName = 'input_video.mp4'
    const audioName = 'input_audio' + extOf(audio.name, '.mp3')
    const outName = 'output.mp4'
    const musicVol = Math.max(0.05, musicVolume / 100)
    const origVol = Math.max(0, originalVolume / 100)
    const cleanupNames = [videoName, audioName, outName]

    try {
      for (const name of cleanupNames) {
        try {
          await ffmpeg.deleteFile(name)
        } catch {
          /* ok */
        }
      }

      setStatus('Caricamento audio…')
      await yieldUI()
      await ffmpeg.writeFile(audioName, await fetchFile(audio))

      setStatus('Caricamento video…')
      await yieldUI()
      await ffmpeg.writeFile(videoName, await fetchFile(video))

      setStatus('Unione leggera (senza ricodificare il video)…')
      await yieldUI()

      // Mobile-safe: copy video stream only (re-encode OOM-kills iOS PWAs).
      // No infinite stream_loop (hangs/crashes wasm on phones).
      const replaceArgs = [
        '-i',
        videoName,
        '-i',
        audioName,
        '-filter_complex',
        `[1:a]volume=${musicVol}[a]`,
        '-map',
        '0:v:0',
        '-map',
        '[a]',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '160k',
        '-movflags',
        '+faststart',
        '-shortest',
        outName,
      ]

      if (mixMode === 'replace') {
        await runFfmpeg(replaceArgs)
      } else {
        try {
          await runFfmpeg([
            '-i',
            videoName,
            '-i',
            audioName,
            '-filter_complex',
            `[0:a]volume=${origVol}[a0];[1:a]volume=${musicVol}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]`,
            '-map',
            '0:v:0',
            '-map',
            '[a]',
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-b:a',
            '160k',
            '-movflags',
            '+faststart',
            '-shortest',
            outName,
          ])
        } catch {
          setStatus('Mix non riuscito: uso solo la musica…')
          await yieldUI()
          await runFfmpeg(replaceArgs)
        }
      }

      await finishOutput(outName, 'nastro-musica.mp4', [videoName, audioName])
      setStatus('Fatto! Guarda l’anteprima e scarica l’MP4.')
    } catch (err) {
      console.error(err)
      setError(
        isMobileDevice()
          ? 'Il telefono ha esaurito la memoria. Comprimi prima il video (720p), poi riprova Musica.'
          : 'Elaborazione fallita. Prova MP4 + MP3 più leggeri.',
      )
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

  const canCompress = Boolean(video && ready && !busy)
  const canMix = Boolean(
    video && audio && ready && !busy && video.size <= musicVideoLimitBytes(),
  )

  let help = ''
  if (!ready && loadingEngine) help = 'Attendi: sto caricando il motore video…'
  else if (!ready) help = 'Motore non pronto: ricarica o usa Chrome/Edge.'
  else if (tab === 'compress') {
    if (!video) help = 'Carica un video, scegli qualità/FPS e premi Comprimi.'
    else if (busy) help = 'Compressione in corso…'
  }   else if (!video && !audio)
    help = isMobileDevice()
      ? 'Su telefono: prima Comprimi a 720p, poi qui carica video leggero + MP3.'
      : 'Carica video + file audio (MP3/M4A), poi premi il pulsante.'
  else if (!video) help = 'Manca il video.'
  else if (!audio) help = 'Manca la musica (file sul telefono, non Spotify).'
  else if (video.size > musicVideoLimitBytes())
    help = `Questo video (${formatBytes(video.size)}) è troppo pesante: comprimilo prima.`
  else if (busy) help = 'Elaborazione in corso… non chiudere l’app.'

  return (
    <main className="app">
      <header>
        <div className="brand">
          <BrandMark />
          <h1 className="brand-name">Nastro</h1>
        </div>
        <p className="tagline">
          Comprimi i video tenendo una bella qualità, oppure metti la tua musica. Tutto resta sul
          tuo dispositivo.
        </p>
      </header>

      <div
        className="tabs"
        role="tablist"
        aria-label="Modalità"
      >
        <button
          type="button"
          role="tab"
          className={`tab ${tab === 'compress' ? 'active' : ''}`}
          aria-selected={tab === 'compress'}
          onClick={() => {
            setTab('compress')
            setError(null)
            clearResult()
          }}
        >
          Comprimi
        </button>
        <button
          type="button"
          role="tab"
          className={`tab ${tab === 'music' ? 'active' : ''}`}
          aria-selected={tab === 'music'}
          onClick={() => {
            setTab('music')
            setError(null)
            clearResult()
          }}
        >
          Musica
        </button>
      </div>

      <div className="workspace">
        <div className={`drop-grid ${tab === 'compress' ? 'single' : ''}`}>
          <label
            className={`dropzone ${video ? 'has-file' : ''} ${dragOver === 'video' ? 'active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver('video')
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => onDrop('video', e)}
          >
            <p className="drop-label">Video</p>
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

          {tab === 'music' && (
            <label
              className={`dropzone ${audio ? 'has-file' : ''} ${dragOver === 'audio' ? 'active' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver('audio')
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => onDrop('audio', e)}
            >
              <p className="drop-label">Musica</p>
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
          )}
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
          {tab === 'compress' ? (
            <>
              <div className="preset-row" role="group" aria-label="Preset qualità">
                {(Object.keys(PRESETS) as QualityPreset[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`preset ${quality === key ? 'active' : ''}`}
                    onClick={() => {
                      setQuality(key)
                      setCrfOverride(null)
                    }}
                  >
                    <strong>{PRESETS[key].label}</strong>
                    <span>{PRESETS[key].hint}</span>
                  </button>
                ))}
              </div>

              <div className="field-grid">
                <div className="control-row">
                  <label htmlFor="fps">FPS</label>
                  <select
                    id="fps"
                    value={fps}
                    onChange={(e) => setFps(e.target.value as FpsOption)}
                  >
                    <option value="original">Come l’originale</option>
                    <option value="60">60 fps</option>
                    <option value="30">30 fps</option>
                    <option value="24">24 fps (cinema)</option>
                    <option value="15">15 fps</option>
                  </select>
                </div>

                <div className="control-row">
                  <label htmlFor="res">Risoluzione</label>
                  <select
                    id="res"
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value as ResOption)}
                  >
                    <option value="original">Come l’originale</option>
                    <option value="1080">1080p</option>
                    <option value="720">720p</option>
                    <option value="480">480p</option>
                  </select>
                </div>
              </div>

              <div className="control-row">
                <label>
                  Qualità fine (CRF) <em>{effectiveCrf}</em>
                </label>
                <input
                  type="range"
                  min={15}
                  max={32}
                  value={effectiveCrf}
                  onChange={(e) => setCrfOverride(Number(e.target.value))}
                />
                <p className="drop-hint">Valori più bassi = qualità più alta e file più grande.</p>
              </div>

              <div className="actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canCompress}
                  onClick={() => void compress()}
                >
                  {busy && tab === 'compress' && <span className="spinner" aria-hidden />}
                  {busy && tab === 'compress' ? 'Compressione…' : 'Comprimi video'}
                </button>
                {resultUrl && tab === 'compress' && (
                  <a className="btn btn-ghost" href={resultUrl} download="nastro-compresso.mp4">
                    Scarica MP4
                  </a>
                )}
              </div>
            </>
          ) : (
            <>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={mixMode === 'mix'}
                  onChange={(e) => setMixMode(e.target.checked ? 'mix' : 'replace')}
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

              {mixMode === 'mix' && (
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
                  onClick={() => void mixMusic()}
                >
                  {busy && tab === 'music' && <span className="spinner" aria-hidden />}
                  {busy && tab === 'music' ? 'Elaborazione…' : 'Metti la musica'}
                </button>
                {resultUrl && tab === 'music' && (
                  <a className="btn btn-ghost" href={resultUrl} download="nastro-musica.mp4">
                    Scarica MP4
                  </a>
                )}
              </div>
            </>
          )}

          {(busy || progress > 0) && (
            <div className="progress" aria-hidden>
              <i style={{ width: `${Math.max(progress, busy ? 5 : 0)}%` }} />
            </div>
          )}

          {video && resultSize != null && (
            <div className="stats">
              <span>
                Originale <strong>{formatBytes(video.size)}</strong>
              </span>
              <span>
                Risultato <strong>{formatBytes(resultSize)}</strong>
              </span>
            </div>
          )}

          <p className={`status ${error ? 'error' : ''}`}>{error ?? (help || status)}</p>
        </section>
      </div>

      <p className="footer">
        Elaborazione locale con FFmpeg · i file non lasciano il browser
      </p>
    </main>
  )
}
