import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import './App.css'
import { engine } from './lib/ffmpegEngine'
import {
  estimateCompressSeconds,
  extOf,
  formatBytes,
  formatDuration,
  isAudioFile,
  isMobileDevice,
  isVideoFile,
  musicVideoLimitBytes,
  readVideoDuration,
  requestWakeLock,
  yieldUI,
} from './lib/format'
import {
  beginAudioComLogin,
  canImportTrack,
  clearAudioComAuth,
  finishAudioComLogin,
  getStoredToken,
  importAudioComTrack,
  searchAudioCom,
  trackPageUrl,
  type AudioComTrack,
} from './lib/audioCom'
import { t, type Lang } from './lib/i18n'

type AppTab =
  | 'compress'
  | 'music'
  | 'edit'
  | 'text'
  | 'convert'
  | 'voice'
  | 'batch'
  | 'settings'
type MixMode = 'replace' | 'mix'
type QualityPreset = 'high' | 'balanced' | 'small'
type FpsOption = 'original' | '60' | '30' | '24' | '15'
type ResOption = 'original' | '1080' | '720' | '480'
type Theme = 'dark' | 'light'
type Rotate = '0' | '90' | '180' | '270'
type Speed = '0.5' | '0.75' | '1' | '1.25' | '1.5' | '2'
type ConvertKind = 'gif' | 'mp3' | 'wav'
type VoiceMode = 'remove' | 'extract'

type BatchItem = {
  id: string
  file: File
  status: 'queued' | 'running' | 'done' | 'error'
  resultUrl?: string
  error?: string
}

const PRESETS: Record<
  QualityPreset,
  { label: string; hint: string; crf: number; preset: string; mobilePreset: string }
> = {
  high: {
    label: 'Alta',
    hint: 'Ottima qualità',
    crf: 18,
    preset: 'medium',
    mobilePreset: 'veryfast',
  },
  balanced: {
    label: 'Bilanciata',
    hint: 'Buon compromesso',
    crf: 23,
    preset: 'veryfast',
    mobilePreset: 'ultrafast',
  },
  small: {
    label: 'Compatta',
    hint: 'File leggero',
    crf: 28,
    preset: 'ultrafast',
    mobilePreset: 'ultrafast',
  },
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none">
        <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="#E8F2EF" strokeWidth="1.8" />
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
  const videoUrlRef = useRef<string | null>(null)
  const resultUrlRef = useRef<string | null>(null)
  const [ready, setReady] = useState(false)
  const [loadingEngine, setLoadingEngine] = useState(true)
  const [tab, setTab] = useState<AppTab>('compress')
  const [lang, setLang] = useState<Lang>(() =>
    (localStorage.getItem('nastro-lang') as Lang) || 'it',
  )
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem('nastro-theme') as Theme) || 'dark',
  )

  const [video, setVideo] = useState<File | null>(null)
  const [audio, setAudio] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [resultSize, setResultSize] = useState<number | null>(null)
  const [resultKind, setResultKind] = useState<string | null>(null)
  const [resultName, setResultName] = useState('nastro.mp4')

  const [musicVolume, setMusicVolume] = useState(80)
  const [originalVolume, setOriginalVolume] = useState(30)
  const [mixMode, setMixMode] = useState<MixMode>('replace')
  const [loopMusic, setLoopMusic] = useState(true)
  const [musicStart, setMusicStart] = useState(0)
  const [fadeIn, setFadeIn] = useState(0.5)
  const [fadeOut, setFadeOut] = useState(0.8)

  const [quality, setQuality] = useState<QualityPreset>('balanced')
  const [fps, setFps] = useState<FpsOption>('original')
  const [resolution, setResolution] = useState<ResOption>(
    isMobileDevice() ? '720' : 'original',
  )
  const [crfOverride, setCrfOverride] = useState<number | null>(null)

  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [rotate, setRotate] = useState<Rotate>('0')
  const [speed, setSpeed] = useState<Speed>('1')
  const [cropCenter, setCropCenter] = useState(false)

  const [overlayText, setOverlayText] = useState('')
  const [overlaySize, setOverlaySize] = useState(36)
  const [convertKind, setConvertKind] = useState<ConvertKind>('gif')
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('remove')
  const [voiceSource, setVoiceSource] = useState<File | null>(null)
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null)

  const [audioComAuthed, setAudioComAuthed] = useState(false)
  const [audioComQuery, setAudioComQuery] = useState('')
  const [audioComResults, setAudioComResults] = useState<AudioComTrack[]>([])
  const [audioComBusy, setAudioComBusy] = useState(false)

  const [batch, setBatch] = useState<BatchItem[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('Caricamento motore video…')
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<'video' | 'audio' | null>(null)

  const mobile = isMobileDevice()
  const effectiveCrf = crfOverride ?? PRESETS[quality].crf
  const eta = useMemo(
    () => (video ? estimateCompressSeconds(video.size, mobile) : 0),
    [video, mobile],
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('nastro-theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('nastro-lang', lang)
  }, [lang])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        await engine.ensureLoaded({
          onProgress: (p) => {
            if (!cancelled) setProgress(p)
          },
        })
        if (!cancelled) {
          setReady(true)
          setLoadingEngine(false)
          setStatus(lang === 'it' ? 'Pronto.' : 'Ready.')
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setLoadingEngine(false)
          setReady(false)
          setError(
            lang === 'it'
              ? 'Motore non disponibile. Usa Chrome/Edge e ricarica.'
              : 'Engine unavailable. Use Chrome/Edge and reload.',
          )
        }
      }
    }
    void load()
    return () => {
      cancelled = true
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current)
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
    }
  }, [lang])

  useEffect(() => {
    return () => {
      if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl)
    }
  }, [voicePreviewUrl])

  useEffect(() => {
    setAudioComAuthed(Boolean(getStoredToken()))
    const params = new URLSearchParams(window.location.search)
    if (params.get('audiocom') === '1') {
      const code = sessionStorage.getItem('nastro-audiocom-code')
      sessionStorage.removeItem('nastro-audiocom-code')
      window.history.replaceState({}, '', '/')
      if (code) {
        void (async () => {
          try {
            setStatus(lang === 'it' ? 'Collego Audio.com…' : 'Connecting Audio.com…')
            await finishAudioComLogin(code)
            setAudioComAuthed(true)
            setTab('music')
            setStatus(
              lang === 'it'
                ? 'Audio.com collegato. Cerca una traccia scaricabile.'
                : 'Audio.com connected. Search a downloadable track.',
            )
          } catch (err) {
            console.error(err)
            setError(err instanceof Error ? err.message : 'Audio.com login failed')
          }
        })()
      }
    }
  }, [lang])

  function setPreviewVideo(file: File | null) {
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current)
      videoUrlRef.current = null
    }
    if (!file) {
      setVideoUrl(null)
      setVideoDuration(0)
      return
    }
    const url = URL.createObjectURL(file)
    videoUrlRef.current = url
    setVideoUrl(url)
    void readVideoDuration(file).then((d) => {
      setVideoDuration(d)
      setTrimEnd(d > 0 ? Number(d.toFixed(1)) : 0)
    })
  }

  function clearResult() {
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = null
    }
    setResultUrl(null)
    setResultSize(null)
    setResultKind(null)
    setProgress(0)
  }

  function publishResult(blob: Blob, name: string, kind: string) {
    const url = URL.createObjectURL(blob)
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
    resultUrlRef.current = url
    setResultUrl(url)
    setResultSize(blob.size)
    setResultKind(kind)
    setResultName(name)
    setProgress(100)
  }

  function switchTab(next: AppTab) {
    if (busy) return
    setTab(next)
    setError(null)
  }

  function pickFile(kind: 'video' | 'audio', file: File | undefined | null) {
    if (!file || busy) return
    setError(null)
    clearResult()
    if (kind === 'video') {
      if (!isVideoFile(file)) {
        setError(lang === 'it' ? 'Seleziona un video.' : 'Select a video.')
        return
      }
      setVideo(file)
      setPreviewVideo(file)
      setStatus(`${file.name} · ${formatBytes(file.size)}`)
      return
    }
    if (!isAudioFile(file)) {
      setError(lang === 'it' ? 'Seleziona un audio.' : 'Select an audio file.')
      return
    }
    setAudio(file)
    setStatus(`${file.name} · ${formatBytes(file.size)}`)
  }

  function onDrop(kind: 'video' | 'audio', e: DragEvent) {
    e.preventDefault()
    setDragOver(null)
    pickFile(kind, e.dataTransfer.files?.[0])
  }

  function pickVoiceMedia(file: File | undefined | null) {
    if (!file || busy) return
    setError(null)
    clearResult()
    if (!isAudioFile(file) && !isVideoFile(file)) {
      setError(
        lang === 'it'
          ? 'Carica un file audio o video stereo.'
          : 'Upload a stereo audio or video file.',
      )
      return
    }
    if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl)
    const url = URL.createObjectURL(file)
    setVoicePreviewUrl(url)
    setVoiceSource(file)
    setStatus(`${file.name} · ${formatBytes(file.size)}`)
  }

  function cancelJob() {
    engine.requestCancel()
    setBusy(false)
    setStatus(lang === 'it' ? 'Annullato.' : 'Cancelled.')
    setError(null)
  }

  async function withJob(fn: () => Promise<void>) {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    setProgress(1)
    const wake = await requestWakeLock()
    try {
      // Reload engine if previously terminated by cancel
      await engine.ensureLoaded({
        onProgress: (p) => setProgress(p),
      })
      await fn()
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('cancelled') || engine.wasCancelled()) {
        setStatus(lang === 'it' ? 'Annullato.' : 'Cancelled.')
      } else {
        setError(
          mobile
            ? lang === 'it'
              ? 'Operazione fallita (memoria?). Prova Compatta + 720p.'
              : 'Failed (memory?). Try Compact + 720p.'
            : lang === 'it'
              ? 'Operazione fallita. Prova file più leggeri.'
              : 'Failed. Try smaller files.',
        )
        setStatus('')
      }
    } finally {
      try {
        await wake?.release()
      } catch {
        /* ignore */
      }
      setBusy(false)
    }
  }

  async function compressOne(file: File) {
    const videoName = 'input_video' + extOf(file.name, '.mp4')
    const outName = 'compressed.mp4'
    const presetCfg = PRESETS[quality]
    const preset = mobile ? presetCfg.mobilePreset : presetCfg.preset
    await engine.delete(videoName)
    await engine.delete(outName)
    setStatus(lang === 'it' ? 'Caricamento…' : 'Loading…')
    await yieldUI()
    await engine.write(videoName, file)
    setStatus(
      lang === 'it'
        ? `Compressione… stima ~${formatDuration(eta || estimateCompressSeconds(file.size, mobile))}`
        : `Compressing… ETA ~${formatDuration(eta || estimateCompressSeconds(file.size, mobile))}`,
    )
    const filters: string[] = []
    if (resolution !== 'original') {
      filters.push(`scale=-2:'min(${resolution},ih)':flags=fast_bilinear`)
    }
    if (fps !== 'original') filters.push(`fps=${fps}`)
    const args = ['-i', videoName]
    if (filters.length) args.push('-vf', filters.join(','))
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      preset,
      '-crf',
      String(effectiveCrf),
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
    await engine.exec(args)
    return engine.readBlob(outName, 'video/mp4', [videoName])
  }

  function compress() {
    if (!video) return
    void withJob(async () => {
      const blob = await compressOne(video)
      publishResult(blob, 'nastro-compresso.mp4', 'compress')
      const saved =
        video.size > 0 && blob.size < video.size
          ? Math.round((1 - blob.size / video.size) * 100)
          : 0
      setStatus(
        saved > 0
          ? lang === 'it'
            ? `Fatto! Circa ${saved}% più leggero.`
            : `Done! About ${saved}% smaller.`
          : lang === 'it'
            ? 'Fatto!'
            : 'Done!',
      )
    })
  }

  function useCompressedForMusic() {
    if (!resultUrl || resultKind !== 'compress') return
    void (async () => {
      const blob = await (await fetch(resultUrl)).blob()
      const file = new File([blob], 'nastro-compresso.mp4', { type: 'video/mp4' })
      setVideo(file)
      setPreviewVideo(file)
      clearResult()
      setTab('music')
      setStatus(
        file.size <= musicVideoLimitBytes()
          ? lang === 'it'
            ? 'Video pronto per la musica. Carica un MP3.'
            : 'Video ready for music. Add an MP3.'
          : lang === 'it'
            ? 'Ancora pesante: riprova Compatta + 480p.'
            : 'Still heavy: try Compact + 480p.',
      )
    })()
  }

  function mixMusic() {
    if (!video || !audio) return
    if (video.size > musicVideoLimitBytes()) {
      setError(
        lang === 'it'
          ? `Video troppo pesante (${formatBytes(video.size)}). Comprimi prima.`
          : `Video too large (${formatBytes(video.size)}). Compress first.`,
      )
      return
    }
    void withJob(async () => {
      const videoName = 'input_video' + extOf(video.name, '.mp4')
      const audioName = 'input_audio' + extOf(audio.name, '.mp3')
      const outName = 'output.mp4'
      const musicVol = Math.max(0.05, musicVolume / 100)
      const origVol = Math.max(0, originalVolume / 100)
      for (const n of [videoName, audioName, outName]) await engine.delete(n)
      setStatus(lang === 'it' ? 'Caricamento audio…' : 'Loading audio…')
      await engine.write(audioName, audio)
      setStatus(lang === 'it' ? 'Caricamento video…' : 'Loading video…')
      await engine.write(videoName, video)
      setStatus(lang === 'it' ? 'Unione musica…' : 'Mixing music…')

      const fadeParts = [
        fadeIn > 0 ? `afade=t=in:st=0:d=${fadeIn}` : '',
        fadeOut > 0 && videoDuration > 0
          ? `afade=t=out:st=${Math.max(0, videoDuration - fadeOut)}:d=${fadeOut}`
          : '',
      ].filter(Boolean)
      const musicChain = [
        musicStart > 0 ? `atrim=start=${musicStart},asetpts=PTS-STARTPTS` : '',
        `volume=${musicVol}`,
        ...fadeParts,
        loopMusic ? 'aloop=loop=-1:size=2e+09' : '',
      ]
        .filter(Boolean)
        .join(',')

      if (mixMode === 'replace') {
        await engine.exec([
          '-i',
          videoName,
          '-i',
          audioName,
          '-filter_complex',
          `[1:a]${musicChain}[a]`,
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
      } else {
        try {
          await engine.exec([
            '-i',
            videoName,
            '-i',
            audioName,
            '-filter_complex',
            `[0:a]volume=${origVol}[a0];[1:a]${musicChain}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]`,
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
          await engine.exec([
            '-i',
            videoName,
            '-i',
            audioName,
            '-filter_complex',
            `[1:a]${musicChain}[a]`,
            '-map',
            '0:v:0',
            '-map',
            '[a]',
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-shortest',
            outName,
          ])
        }
      }
      const blob = await engine.readBlob(outName, 'video/mp4', [videoName, audioName])
      publishResult(blob, 'nastro-musica.mp4', 'music')
      setStatus(lang === 'it' ? 'Fatto!' : 'Done!')
    })
  }

  function editVideo() {
    if (!video) return
    void withJob(async () => {
      const videoName = 'input_video' + extOf(video.name, '.mp4')
      const outName = 'edited.mp4'
      await engine.delete(videoName)
      await engine.delete(outName)
      await engine.write(videoName, video)
      setStatus(lang === 'it' ? 'Modifica in corso…' : 'Editing…')

      const filters: string[] = []
      if (rotate === '90') filters.push('transpose=1')
      if (rotate === '180') filters.push('transpose=1,transpose=1')
      if (rotate === '270') filters.push('transpose=2')
      if (cropCenter) filters.push('crop=iw*0.85:ih*0.85')
      if (speed !== '1') {
        const s = Number(speed)
        filters.push(`setpts=${(1 / s).toFixed(4)}*PTS`)
      }

      const args = ['-i', videoName]
      if (trimStart > 0) args.push('-ss', String(trimStart))
      if (trimEnd > trimStart) args.push('-to', String(trimEnd))
      if (filters.length) args.push('-vf', filters.join(','))
      if (speed !== '1') {
        args.push('-af', `atempo=${Math.min(2, Math.max(0.5, Number(speed)))}`)
      }
      args.push(
        '-c:v',
        'libx264',
        '-preset',
        mobile ? 'ultrafast' : 'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        outName,
      )
      await engine.exec(args)
      const blob = await engine.readBlob(outName, 'video/mp4', [videoName])
      publishResult(blob, 'nastro-modifica.mp4', 'edit')
      setStatus(lang === 'it' ? 'Fatto!' : 'Done!')
    })
  }

  function burnText() {
    if (!video || !overlayText.trim()) return
    void withJob(async () => {
      const videoName = 'input_video' + extOf(video.name, '.mp4')
      const outName = 'texted.mp4'
      await engine.delete(videoName)
      await engine.delete(outName)
      await engine.write(videoName, video)
      setStatus(lang === 'it' ? 'Aggiungo testo…' : 'Burning text…')
      const safe = overlayText
        .replace(/\\/g, '\\\\')
        .replace(/:/g, '\\:')
        .replace(/'/g, "\\\\'")
        .slice(0, 80)
      // drawtext may be unavailable in some wasm builds — fallback to overlay box via geq is hard;
      // try drawtext, else fail clearly.
      try {
        await engine.exec([
          '-i',
          videoName,
          '-vf',
          `drawtext=text='${safe}':fontsize=${overlaySize}:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-text_h-40`,
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-crf',
          '23',
          '-c:a',
          'copy',
          '-movflags',
          '+faststart',
          outName,
        ])
      } catch {
        throw new Error(
          lang === 'it'
            ? 'Testo non supportato in questo browser. Prova Chrome desktop.'
            : 'Text overlay unsupported here. Try desktop Chrome.',
        )
      }
      const blob = await engine.readBlob(outName, 'video/mp4', [videoName])
      publishResult(blob, 'nastro-testo.mp4', 'text')
      setStatus(lang === 'it' ? 'Fatto!' : 'Done!')
    })
  }

  function convert() {
    if (!video) return
    void withJob(async () => {
      const videoName = 'input_video' + extOf(video.name, '.mp4')
      await engine.delete(videoName)
      await engine.write(videoName, video)
      if (convertKind === 'gif') {
        const outName = 'out.gif'
        await engine.delete(outName)
        setStatus(lang === 'it' ? 'Creo GIF…' : 'Making GIF…')
        await engine.exec([
          '-i',
          videoName,
          '-t',
          '6',
          '-vf',
          'fps=10,scale=480:-1:flags=lanczos',
          outName,
        ])
        const blob = await engine.readBlob(outName, 'image/gif', [videoName])
        publishResult(blob, 'nastro.gif', 'gif')
      } else if (convertKind === 'mp3') {
        const outName = 'out.mp3'
        await engine.delete(outName)
        setStatus(lang === 'it' ? 'Estraggo MP3…' : 'Extracting MP3…')
        await engine.exec(['-i', videoName, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', outName])
        const blob = await engine.readBlob(outName, 'audio/mpeg', [videoName])
        publishResult(blob, 'nastro.mp3', 'mp3')
      } else {
        const outName = 'out.wav'
        await engine.delete(outName)
        setStatus(lang === 'it' ? 'Estraggo WAV…' : 'Extracting WAV…')
        await engine.exec(['-i', videoName, '-vn', outName])
        const blob = await engine.readBlob(outName, 'audio/wav', [videoName])
        publishResult(blob, 'nastro.wav', 'wav')
      }
      setStatus(lang === 'it' ? 'Fatto!' : 'Done!')
    })
  }

  async function runAudioComSearch() {
    setError(null)
    setAudioComBusy(true)
    try {
      const results = await searchAudioCom(audioComQuery.trim())
      setAudioComResults(results)
      setStatus(
        results.length
          ? lang === 'it'
            ? `${results.length} risultati Audio.com`
            : `${results.length} Audio.com results`
          : lang === 'it'
            ? 'Nessun risultato'
            : 'No results',
      )
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setAudioComBusy(false)
    }
  }

  async function bringAudioComTrack(track: AudioComTrack) {
    setError(null)
    setAudioComBusy(true)
    try {
      const file = await importAudioComTrack(track)
      setAudio(file)
      setTab('music')
      setStatus(
        lang === 'it'
          ? `«${track.title}» pronta. Carica un video e premi Metti la musica.`
          : `“${track.title}” ready. Load a video and add music.`,
      )
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setAudioComBusy(false)
    }
  }

  function separateVoice() {
    if (!voiceSource) return
    void withJob(async () => {
      const inName = 'voice_in' + extOf(voiceSource.name, '.mp3')
      const outName = voiceMode === 'remove' ? 'strumentale.mp3' : 'voce.mp3'
      await engine.delete(inName)
      await engine.delete(outName)
      setStatus(
        lang === 'it'
          ? voiceMode === 'remove'
            ? 'Tolgo la voce…'
            : 'Estraggo la voce…'
          : voiceMode === 'remove'
            ? 'Removing vocals…'
            : 'Extracting vocals…',
      )
      await engine.write(inName, voiceSource)

      // Stereo mid/side heuristics (best when vocals are centered).
      // remove: L-R / R-L cancels center · extract: mid channel + voice band
      const filter =
        voiceMode === 'remove'
          ? 'pan=stereo|c0=0.5*c0+-0.5*c1|c1=0.5*c1+-0.5*c0,volume=1.55'
          : 'pan=mono|c0=0.5*c0+0.5*c1,highpass=f=120,lowpass=f=7200,volume=1.6'

      await engine.exec([
        '-i',
        inName,
        '-vn',
        '-af',
        filter,
        '-c:a',
        'libmp3lame',
        '-b:a',
        '192k',
        outName,
      ])

      const blob = await engine.readBlob(outName, 'audio/mpeg', [inName])
      publishResult(
        blob,
        voiceMode === 'remove' ? 'nastro-strumentale.mp3' : 'nastro-voce.mp3',
        voiceMode === 'remove' ? 'instrumental' : 'vocals',
      )
      setStatus(
        lang === 'it'
          ? 'Fatto! Funziona meglio su mix stereo con voce al centro.'
          : 'Done! Works best on stereo mixes with centered vocals.',
      )
    })
  }

  function addBatchFiles(list: FileList | null) {
    if (!list) return
    const items: BatchItem[] = [...list]
      .filter(isVideoFile)
      .map((file) => ({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        status: 'queued' as const,
      }))
    setBatch((prev) => [...prev, ...items])
  }

  function runBatch() {
    if (!batch.length) return
    void withJob(async () => {
      const next = [...batch]
      for (let i = 0; i < next.length; i++) {
        const item = next[i]
        if (item.status === 'done') continue
        next[i] = { ...item, status: 'running' }
        setBatch([...next])
        setStatus(`${lang === 'it' ? 'Coda' : 'Queue'}: ${item.file.name}`)
        try {
          const blob = await compressOne(item.file)
          const url = URL.createObjectURL(blob)
          next[i] = { ...item, status: 'done', resultUrl: url }
        } catch (err) {
          next[i] = {
            ...item,
            status: 'error',
            error: err instanceof Error ? err.message : 'error',
          }
        }
        setBatch([...next])
      }
      setStatus(lang === 'it' ? 'Coda completata.' : 'Queue complete.')
      setProgress(100)
    })
  }

  const canRun = Boolean(video && ready && !busy)
  const canMix = Boolean(
    video && audio && ready && !busy && video.size <= musicVideoLimitBytes(),
  )
  const canVoice = Boolean(voiceSource && ready && !busy)

  const tabs: { id: AppTab; label: string }[] = [
    { id: 'compress', label: t(lang, 'compress') },
    { id: 'music', label: t(lang, 'music') },
    { id: 'edit', label: t(lang, 'edit') },
    { id: 'text', label: t(lang, 'text') },
    { id: 'convert', label: t(lang, 'convert') },
    { id: 'voice', label: t(lang, 'voice') },
    { id: 'batch', label: t(lang, 'batch') },
    { id: 'settings', label: t(lang, 'settings') },
  ]

  return (
    <main className="app">
      <header>
        <div className="brand">
          <BrandMark />
          <h1 className="brand-name">Nastro</h1>
        </div>
        <p className="tagline">{t(lang, 'tagline')}</p>
      </header>

      <div className="tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={`tab ${tab === item.id ? 'active' : ''}`}
            aria-selected={tab === item.id}
            disabled={busy && tab !== item.id}
            onClick={() => switchTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="workspace">
        {tab !== 'settings' && tab !== 'batch' && tab !== 'voice' && (
          <div className={`drop-grid ${tab === 'music' ? '' : 'single'}`}>
            <label
              className={`dropzone ${video ? 'has-file' : ''} ${dragOver === 'video' ? 'active' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver('video')
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => onDrop('video', e)}
            >
              <p className="drop-label">{t(lang, 'video')}</p>
              <p className="drop-hint">{t(lang, 'dropVideo')}</p>
              {video && (
                <div className="file-chip">
                  <span>
                    {video.name} · {formatBytes(video.size)}
                    {videoDuration > 0 ? ` · ${formatDuration(videoDuration)}` : ''}
                  </span>
                </div>
              )}
              <input
                type="file"
                accept="video/*"
                disabled={busy}
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
                <p className="drop-label">{t(lang, 'audio')}</p>
                <p className="drop-hint">{t(lang, 'dropAudio')}</p>
                {audio && (
                  <div className="file-chip">
                    <span>
                      {audio.name} · {formatBytes(audio.size)}
                    </span>
                  </div>
                )}
                <input
                  type="file"
                  accept="audio/*"
                  disabled={busy}
                  onChange={(e) => pickFile('audio', e.target.files?.[0])}
                />
              </label>
            )}
          </div>
        )}

        {tab === 'voice' && (
          <label
            className={`dropzone single ${voiceSource ? 'has-file' : ''} ${dragOver === 'audio' ? 'active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver('audio')
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(null)
              pickVoiceMedia(e.dataTransfer.files?.[0])
            }}
          >
            <p className="drop-label">{t(lang, 'voice')}</p>
            <p className="drop-hint">{t(lang, 'dropVoice')}</p>
            {voiceSource && (
              <div className="file-chip">
                <span>
                  {voiceSource.name} · {formatBytes(voiceSource.size)}
                </span>
              </div>
            )}
            <input
              type="file"
              accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mov"
              disabled={busy}
              onChange={(e) => pickVoiceMedia(e.target.files?.[0])}
            />
          </label>
        )}

        {tab === 'batch' && (
          <label className="dropzone single has-file">
            <p className="drop-label">{t(lang, 'batch')}</p>
            <p className="drop-hint">
              {lang === 'it'
                ? 'Seleziona più video da comprimere in coda'
                : 'Select multiple videos to compress in queue'}
            </p>
            <input
              type="file"
              accept="video/*"
              multiple
              disabled={busy}
              onChange={(e) => addBatchFiles(e.target.files)}
            />
          </label>
        )}

        {((videoUrl && tab !== 'voice' && tab !== 'settings' && tab !== 'batch') ||
          (voicePreviewUrl && tab === 'voice') ||
          (resultUrl && tab !== 'settings' && tab !== 'batch')) && (
          <div className="preview">
            {resultKind === 'gif' && resultUrl ? (
              <img src={resultUrl} alt="GIF" />
            ) : resultKind === 'instrumental' ||
              resultKind === 'vocals' ||
              resultKind === 'mp3' ||
              resultKind === 'wav' ||
              (tab === 'voice' && !resultUrl && voicePreviewUrl) ? (
              <audio
                key={resultUrl ?? voicePreviewUrl ?? 'a'}
                src={resultUrl ?? voicePreviewUrl ?? undefined}
                controls
                style={{ width: '100%', margin: '1rem', display: 'block' }}
              />
            ) : (
              <video
                key={resultUrl ?? videoUrl ?? 'v'}
                src={resultUrl ?? videoUrl ?? undefined}
                controls
                playsInline
              />
            )}
          </div>
        )}

        <section className="controls">
          {tab === 'compress' && (
            <>
              <div className="preset-row">
                {(Object.keys(PRESETS) as QualityPreset[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`preset ${quality === key ? 'active' : ''}`}
                    disabled={busy}
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
                    disabled={busy}
                    onChange={(e) => setFps(e.target.value as FpsOption)}
                  >
                    <option value="original">Original</option>
                    <option value="60">60</option>
                    <option value="30">30</option>
                    <option value="24">24</option>
                    <option value="15">15</option>
                  </select>
                </div>
                <div className="control-row">
                  <label htmlFor="res">{lang === 'it' ? 'Risoluzione' : 'Resolution'}</label>
                  <select
                    id="res"
                    value={resolution}
                    disabled={busy}
                    onChange={(e) => setResolution(e.target.value as ResOption)}
                  >
                    <option value="original">Original</option>
                    <option value="1080">1080p</option>
                    <option value="720">720p</option>
                    <option value="480">480p</option>
                  </select>
                </div>
              </div>
              <div className="control-row">
                <label>
                  CRF <em>{effectiveCrf}</em>
                </label>
                <input
                  type="range"
                  min={15}
                  max={32}
                  value={effectiveCrf}
                  disabled={busy}
                  onChange={(e) => setCrfOverride(Number(e.target.value))}
                />
              </div>
              {video && (
                <p className="drop-hint">
                  {lang === 'it' ? 'Tempo stimato' : 'Estimated time'}: ~{formatDuration(eta)}
                </p>
              )}
              <div className="actions">
                <button type="button" className="btn btn-primary" disabled={!canRun} onClick={compress}>
                  {busy ? t(lang, 'busy') : t(lang, 'compress')}
                </button>
                {busy && (
                  <button type="button" className="btn btn-danger" onClick={cancelJob}>
                    {t(lang, 'cancel')}
                  </button>
                )}
                {resultUrl && resultKind === 'compress' && (
                  <>
                    <a className="btn btn-ghost" href={resultUrl} download={resultName}>
                      {t(lang, 'download')}
                    </a>
                    <button type="button" className="btn btn-ghost" onClick={useCompressedForMusic}>
                      {lang === 'it' ? 'Usa in Musica' : 'Use in Music'}
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          {tab === 'music' && (
            <>
              <div className="audiocom-box">
                <p className="drop-label">Audio.com</p>
                <p className="drop-hint">
                  {lang === 'it'
                    ? 'Cerca tracce pubbliche. Import solo se download abilitato dall’autore o licenza Creative Commons.'
                    : 'Search public tracks. Import only if download is enabled or Creative Commons.'}
                </p>
                <div className="actions" style={{ marginTop: '0.6rem' }}>
                  {!audioComAuthed ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || audioComBusy}
                      onClick={() => void beginAudioComLogin()}
                    >
                      {lang === 'it' ? 'Accedi ad Audio.com' : 'Sign in to Audio.com'}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy || audioComBusy}
                        onClick={() => {
                          clearAudioComAuth()
                          setAudioComAuthed(false)
                          setAudioComResults([])
                        }}
                      >
                        {lang === 'it' ? 'Esci Audio.com' : 'Sign out'}
                      </button>
                    </>
                  )}
                </div>
                {audioComAuthed && (
                  <>
                    <div className="field-grid" style={{ marginTop: '0.75rem' }}>
                      <div className="control-row">
                        <label htmlFor="acq">
                          {lang === 'it' ? 'Cerca canzone' : 'Search song'}
                        </label>
                        <input
                          id="acq"
                          type="text"
                          value={audioComQuery}
                          disabled={busy || audioComBusy}
                          placeholder={lang === 'it' ? 'es. piano lofi' : 'e.g. piano lofi'}
                          onChange={(e) => setAudioComQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void runAudioComSearch()
                          }}
                        />
                      </div>
                      <div className="actions" style={{ alignItems: 'end' }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={busy || audioComBusy}
                          onClick={() => void runAudioComSearch()}
                        >
                          {audioComBusy
                            ? t(lang, 'busy')
                            : lang === 'it'
                              ? 'Cerca'
                              : 'Search'}
                        </button>
                      </div>
                    </div>
                    <div className="batch-list" style={{ marginTop: '0.75rem' }}>
                      {audioComResults.map((track) => {
                        const ok = canImportTrack(track)
                        return (
                          <div key={track.id} className="batch-item">
                            <span>
                              <strong>{track.title}</strong>
                              <br />
                              <span className="drop-hint">
                                {track.author_name || track.username || '—'} ·{' '}
                                {track.license || 'license?'} ·{' '}
                                {track.is_downloadable
                                  ? lang === 'it'
                                    ? 'download ok'
                                    : 'downloadable'
                                  : lang === 'it'
                                    ? 'no download'
                                    : 'no download'}
                              </span>
                            </span>
                            <span className="actions">
                              <a
                                className="btn btn-ghost"
                                href={trackPageUrl(track)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Audio.com
                              </a>
                              <button
                                type="button"
                                className="btn btn-primary"
                                disabled={!ok || busy || audioComBusy}
                                onClick={() => void bringAudioComTrack(track)}
                              >
                                {lang === 'it' ? 'Usa' : 'Use'}
                              </button>
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>

              <label className="toggle">
                <input
                  type="checkbox"
                  checked={mixMode === 'mix'}
                  disabled={busy}
                  onChange={(e) => setMixMode(e.target.checked ? 'mix' : 'replace')}
                />
                {lang === 'it' ? 'Mix con audio originale' : 'Mix with original audio'}
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={loopMusic}
                  disabled={busy}
                  onChange={(e) => setLoopMusic(e.target.checked)}
                />
                {lang === 'it' ? 'Ripeti musica se più corta' : 'Loop music if shorter'}
              </label>
              <div className="control-row">
                <label>
                  {lang === 'it' ? 'Volume musica' : 'Music volume'} <em>{musicVolume}%</em>
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={musicVolume}
                  disabled={busy}
                  onChange={(e) => setMusicVolume(Number(e.target.value))}
                />
              </div>
              {mixMode === 'mix' && (
                <div className="control-row">
                  <label>
                    {lang === 'it' ? 'Volume originale' : 'Original volume'}{' '}
                    <em>{originalVolume}%</em>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={originalVolume}
                    disabled={busy}
                    onChange={(e) => setOriginalVolume(Number(e.target.value))}
                  />
                </div>
              )}
              <div className="field-grid">
                <div className="control-row">
                  <label>
                    {lang === 'it' ? 'Inizio musica (s)' : 'Music start (s)'} <em>{musicStart}</em>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={60}
                    step={0.5}
                    value={musicStart}
                    disabled={busy}
                    onChange={(e) => setMusicStart(Number(e.target.value))}
                  />
                </div>
                <div className="control-row">
                  <label>
                    Fade in/out <em>{fadeIn}/{fadeOut}s</em>
                  </label>
                  <div className="field-grid">
                    <input
                      type="number"
                      min={0}
                      max={5}
                      step={0.1}
                      value={fadeIn}
                      disabled={busy}
                      onChange={(e) => setFadeIn(Number(e.target.value))}
                    />
                    <input
                      type="number"
                      min={0}
                      max={5}
                      step={0.1}
                      value={fadeOut}
                      disabled={busy}
                      onChange={(e) => setFadeOut(Number(e.target.value))}
                    />
                  </div>
                </div>
              </div>
              <div className="actions">
                <button type="button" className="btn btn-primary" disabled={!canMix} onClick={mixMusic}>
                  {busy ? t(lang, 'busy') : lang === 'it' ? 'Metti la musica' : 'Add music'}
                </button>
                {busy && (
                  <button type="button" className="btn btn-danger" onClick={cancelJob}>
                    {t(lang, 'cancel')}
                  </button>
                )}
                {resultUrl && resultKind === 'music' && (
                  <a className="btn btn-ghost" href={resultUrl} download={resultName}>
                    {t(lang, 'download')}
                  </a>
                )}
              </div>
            </>
          )}

          {tab === 'edit' && (
            <>
              <div className="field-grid">
                <div className="control-row">
                  <label>
                    {lang === 'it' ? 'Inizio (s)' : 'Start (s)'} <em>{trimStart}</em>
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={trimStart}
                    disabled={busy}
                    onChange={(e) => setTrimStart(Number(e.target.value))}
                  />
                </div>
                <div className="control-row">
                  <label>
                    {lang === 'it' ? 'Fine (s)' : 'End (s)'} <em>{trimEnd}</em>
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={trimEnd}
                    disabled={busy}
                    onChange={(e) => setTrimEnd(Number(e.target.value))}
                  />
                </div>
                <div className="control-row">
                  <label htmlFor="rot">{lang === 'it' ? 'Rotazione' : 'Rotate'}</label>
                  <select
                    id="rot"
                    value={rotate}
                    disabled={busy}
                    onChange={(e) => setRotate(e.target.value as Rotate)}
                  >
                    <option value="0">0°</option>
                    <option value="90">90°</option>
                    <option value="180">180°</option>
                    <option value="270">270°</option>
                  </select>
                </div>
                <div className="control-row">
                  <label htmlFor="spd">{lang === 'it' ? 'Velocità' : 'Speed'}</label>
                  <select
                    id="spd"
                    value={speed}
                    disabled={busy}
                    onChange={(e) => setSpeed(e.target.value as Speed)}
                  >
                    <option value="0.5">0.5x</option>
                    <option value="0.75">0.75x</option>
                    <option value="1">1x</option>
                    <option value="1.25">1.25x</option>
                    <option value="1.5">1.5x</option>
                    <option value="2">2x</option>
                  </select>
                </div>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={cropCenter}
                  disabled={busy}
                  onChange={(e) => setCropCenter(e.target.checked)}
                />
                {lang === 'it' ? 'Ritaglia al centro (85%)' : 'Center crop (85%)'}
              </label>
              <div className="actions">
                <button type="button" className="btn btn-primary" disabled={!canRun} onClick={editVideo}>
                  {busy ? t(lang, 'busy') : lang === 'it' ? 'Applica modifiche' : 'Apply edits'}
                </button>
                {busy && (
                  <button type="button" className="btn btn-danger" onClick={cancelJob}>
                    {t(lang, 'cancel')}
                  </button>
                )}
                {resultUrl && resultKind === 'edit' && (
                  <a className="btn btn-ghost" href={resultUrl} download={resultName}>
                    {t(lang, 'download')}
                  </a>
                )}
              </div>
            </>
          )}

          {tab === 'text' && (
            <>
              <div className="control-row">
                <label htmlFor="txt">{lang === 'it' ? 'Testo overlay' : 'Overlay text'}</label>
                <input
                  id="txt"
                  type="text"
                  maxLength={80}
                  value={overlayText}
                  disabled={busy}
                  placeholder={lang === 'it' ? 'Es. Ciao dal video' : 'e.g. Hello'}
                  onChange={(e) => setOverlayText(e.target.value)}
                />
              </div>
              <div className="control-row">
                <label>
                  {lang === 'it' ? 'Dimensione' : 'Size'} <em>{overlaySize}</em>
                </label>
                <input
                  type="range"
                  min={18}
                  max={72}
                  value={overlaySize}
                  disabled={busy}
                  onChange={(e) => setOverlaySize(Number(e.target.value))}
                />
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canRun || !overlayText.trim()}
                  onClick={burnText}
                >
                  {busy ? t(lang, 'busy') : lang === 'it' ? 'Aggiungi testo' : 'Burn text'}
                </button>
                {busy && (
                  <button type="button" className="btn btn-danger" onClick={cancelJob}>
                    {t(lang, 'cancel')}
                  </button>
                )}
                {resultUrl && resultKind === 'text' && (
                  <a className="btn btn-ghost" href={resultUrl} download={resultName}>
                    {t(lang, 'download')}
                  </a>
                )}
              </div>
            </>
          )}

          {tab === 'convert' && (
            <>
              <div className="control-row">
                <label htmlFor="conv">{lang === 'it' ? 'Formato' : 'Format'}</label>
                <select
                  id="conv"
                  value={convertKind}
                  disabled={busy}
                  onChange={(e) => setConvertKind(e.target.value as ConvertKind)}
                >
                  <option value="gif">GIF (max 6s)</option>
                  <option value="mp3">MP3 audio</option>
                  <option value="wav">WAV audio</option>
                </select>
              </div>
              <div className="actions">
                <button type="button" className="btn btn-primary" disabled={!canRun} onClick={convert}>
                  {busy ? t(lang, 'busy') : t(lang, 'convert')}
                </button>
                {busy && (
                  <button type="button" className="btn btn-danger" onClick={cancelJob}>
                    {t(lang, 'cancel')}
                  </button>
                )}
                {resultUrl && ['gif', 'mp3', 'wav'].includes(resultKind || '') && (
                  <a className="btn btn-ghost" href={resultUrl} download={resultName}>
                    {t(lang, 'download')}
                  </a>
                )}
              </div>
            </>
          )}

          {tab === 'voice' && (
            <>
              <div className="preset-row">
                <button
                  type="button"
                  className={`preset ${voiceMode === 'remove' ? 'active' : ''}`}
                  disabled={busy}
                  onClick={() => setVoiceMode('remove')}
                >
                  <strong>{lang === 'it' ? 'Elimina voce' : 'Remove vocals'}</strong>
                  <span>
                    {lang === 'it'
                      ? 'Lascia lo strumentale (karaoke)'
                      : 'Keep instrumental (karaoke)'}
                  </span>
                </button>
                <button
                  type="button"
                  className={`preset ${voiceMode === 'extract' ? 'active' : ''}`}
                  disabled={busy}
                  onClick={() => setVoiceMode('extract')}
                >
                  <strong>{lang === 'it' ? 'Estrai voce' : 'Extract vocals'}</strong>
                  <span>
                    {lang === 'it'
                      ? 'Tieni soprattutto la voce centrale'
                      : 'Keep mainly centered vocals'}
                  </span>
                </button>
              </div>
              <p className="drop-hint">
                {lang === 'it'
                  ? 'Metodo stereo (non IA): funziona meglio se la voce è al centro. Su brani mono o mix particolari il risultato può essere parziale.'
                  : 'Stereo method (not AI): best when vocals are centered. Mono or odd mixes may be partial.'}
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canVoice}
                  onClick={separateVoice}
                >
                  {busy
                    ? t(lang, 'busy')
                    : voiceMode === 'remove'
                      ? lang === 'it'
                        ? 'Elimina voce'
                        : 'Remove vocals'
                      : lang === 'it'
                        ? 'Estrai voce'
                        : 'Extract vocals'}
                </button>
                {busy && (
                  <button type="button" className="btn btn-danger" onClick={cancelJob}>
                    {t(lang, 'cancel')}
                  </button>
                )}
                {resultUrl &&
                  (resultKind === 'instrumental' || resultKind === 'vocals') && (
                    <a className="btn btn-ghost" href={resultUrl} download={resultName}>
                      {t(lang, 'download')}
                    </a>
                  )}
              </div>
            </>
          )}

          {tab === 'batch' && (
            <>
              <div className="batch-list">
                {batch.length === 0 && (
                  <p className="drop-hint">
                    {lang === 'it' ? 'Nessun video in coda.' : 'No videos queued.'}
                  </p>
                )}
                {batch.map((item) => (
                  <div key={item.id} className="batch-item">
                    <span>
                      <strong>{item.file.name}</strong> · {formatBytes(item.file.size)} ·{' '}
                      {item.status}
                    </span>
                    {item.resultUrl && (
                      <a href={item.resultUrl} download={`nastro-${item.file.name}.mp4`}>
                        {t(lang, 'download')}
                      </a>
                    )}
                  </div>
                ))}
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!batch.length || busy || !ready}
                  onClick={runBatch}
                >
                  {busy ? t(lang, 'busy') : lang === 'it' ? 'Avvia coda' : 'Run queue'}
                </button>
                {busy && (
                  <button type="button" className="btn btn-danger" onClick={cancelJob}>
                    {t(lang, 'cancel')}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => setBatch([])}
                >
                  {lang === 'it' ? 'Svuota' : 'Clear'}
                </button>
              </div>
            </>
          )}

          {tab === 'settings' && (
            <>
              <div className="field-grid">
                <div className="control-row">
                  <label htmlFor="theme">{t(lang, 'theme')}</label>
                  <select
                    id="theme"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as Theme)}
                  >
                    <option value="dark">{t(lang, 'dark')}</option>
                    <option value="light">{t(lang, 'light')}</option>
                  </select>
                </div>
                <div className="control-row">
                  <label htmlFor="lang">{t(lang, 'language')}</label>
                  <select id="lang" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                    <option value="it">Italiano</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>
              <p className="drop-hint">
                {lang === 'it'
                  ? 'Backend cloud per file enormi: non incluso (limiti Vercel). Tutto resta locale sul dispositivo.'
                  : 'Cloud backend for huge files: not included (Vercel limits). Everything stays local.'}
              </p>
            </>
          )}

          {(busy || progress > 0) && tab !== 'settings' && (
            <div className="progress" aria-hidden>
              <i style={{ width: `${Math.max(progress, busy ? 5 : 0)}%` }} />
            </div>
          )}

          {video && resultSize != null && tab !== 'settings' && tab !== 'batch' && (
            <div className="stats">
              <span>
                In <strong>{formatBytes(video.size)}</strong>
              </span>
              <span>
                Out <strong>{formatBytes(resultSize)}</strong>
              </span>
            </div>
          )}

          {tab !== 'settings' && (
            <p className={`status ${error ? 'error' : ''}`}>
              {error ??
                (loadingEngine
                  ? lang === 'it'
                    ? 'Caricamento motore…'
                    : 'Loading engine…'
                  : status)}
            </p>
          )}
        </section>
      </div>

      <p className="footer">{t(lang, 'footer')}</p>
    </main>
  )
}
