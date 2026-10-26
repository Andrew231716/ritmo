import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import { useEffect, useRef, useState } from 'react'
import './App.css'

type MixMode = 'replace' | 'mix'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
        ffmpeg.on('log', ({ message }) => {
          if (message.toLowerCase().includes('error')) {
            console.warn(message)
          }
        })
        ffmpeg.on('progress', ({ progress: p }) => {
          if (!cancelled) setProgress(Math.min(99, Math.round(p * 100)))
        })

        const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm'
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
          setError(
            'Impossibile caricare il motore video. Ricarica la pagina o prova un altro browser (Chrome/Edge).',
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
    if (kind === 'video') {
      if (!file.type.startsWith('video/')) {
        setError('Seleziona un file video (mp4, webm, mov…).')
        return
      }
      setVideo(file)
    } else {
      if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) {
        setError('Seleziona un file audio (mp3, wav, m4a…).')
        return
      }
      setAudio(file)
    }
  }

  function onDrop(kind: 'video' | 'audio', e: React.DragEvent) {
    e.preventDefault()
    setDragOver(null)
    pickFile(kind, e.dataTransfer.files?.[0])
  }

  async function mix() {
    if (!video || !audio || !ffmpegRef.current || !ready) return

    setBusy(true)
    setError(null)
    setProgress(0)
    setStatus('Preparazione file…')

    const ffmpeg = ffmpegRef.current
    const videoName = 'input_video' + extOf(video.name, '.mp4')
    const audioName = 'input_audio' + extOf(audio.name, '.mp3')
    const outName = 'output.mp4'

    try {
      await ffmpeg.writeFile(videoName, await fetchFile(video))
      await ffmpeg.writeFile(audioName, await fetchFile(audio))

      const musicVol = Math.max(0.01, musicVolume / 100)
      const origVol = Math.max(0, originalVolume / 100)

      setStatus('Unione in corso…')

      let args: string[]
      if (mode === 'replace') {
        args = [
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
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-shortest',
          '-movflags',
          '+faststart',
          outName,
        ]
      } else {
        args = [
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
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-shortest',
          '-movflags',
          '+faststart',
          outName,
        ]
      }

      await ffmpeg.exec(args)

      const data = await ffmpeg.readFile(outName)
      const bytes =
        typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
      const blob = new Blob([bytes], { type: 'video/mp4' })
      const url = URL.createObjectURL(blob)

      setResultUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })
      setProgress(100)
      setStatus('Fatto! Scarica o rivedi il video.')
    } catch (err) {
      console.error(err)
      // Fallback: if mix fails (e.g. no original audio track), try replace
      if (mode === 'mix') {
        setStatus('Il video non ha audio originale: sostituisco con la musica…')
        try {
          await ffmpeg.deleteFile(outName).catch(() => undefined)
          const musicVol = Math.max(0.01, musicVolume / 100)
          await ffmpeg.exec([
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
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-shortest',
            '-movflags',
            '+faststart',
            outName,
          ])
          const data = await ffmpeg.readFile(outName)
          const bytes =
            typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
          const blob = new Blob([bytes], { type: 'video/mp4' })
          const url = URL.createObjectURL(blob)
          setResultUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev)
            return url
          })
          setProgress(100)
          setStatus('Fatto! (musica sostituita: il video non aveva audio).')
        } catch (err2) {
          console.error(err2)
          setError('Elaborazione fallita. Prova con MP4 + MP3, file più leggeri.')
          setStatus('')
        }
      } else {
        setError('Elaborazione fallita. Prova con MP4 + MP3, file più leggeri.')
        setStatus('')
      }
    } finally {
      try {
        await ffmpeg.deleteFile(videoName)
        await ffmpeg.deleteFile(audioName)
        await ffmpeg.deleteFile(outName)
      } catch {
        /* ignore cleanup errors */
      }
      setBusy(false)
    }
  }

  const canMix = Boolean(video && audio && ready && !busy)

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
              accept="video/*"
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
            <p className="drop-label">Musica</p>
            <p className="drop-hint">Trascina o clicca · MP3, WAV, M4A</p>
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
            <button className="btn btn-primary" disabled={!canMix} onClick={() => void mix()}>
              {busy && <span className="spinner" aria-hidden />}
              {busy ? 'Elaborazione…' : 'Metti la musica'}
            </button>
            {resultUrl && (
              <a className="btn btn-ghost" href={resultUrl} download="ritmo-video.mp4">
                Scarica MP4
              </a>
            )}
          </div>

          {(busy || progress > 0) && (
            <div className="progress" aria-hidden>
              <i style={{ width: `${progress}%` }} />
            </div>
          )}

          <p className={`status ${error ? 'error' : ''}`}>
            {error ?? (loadingEngine ? 'Caricamento motore video…' : status)}
          </p>
        </section>
      </div>

      <p className="footer">
        Elaborazione locale con FFmpeg · i file non lasciano il browser
      </p>
    </main>
  )
}

function extOf(name: string, fallback: string) {
  const i = name.lastIndexOf('.')
  if (i < 0) return fallback
  const ext = name.slice(i).toLowerCase()
  if (ext.length > 8) return fallback
  return ext
}
