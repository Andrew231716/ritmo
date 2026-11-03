import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import { blobFromU8, toU8, yieldUI } from './format'

export type EngineHandlers = {
  onProgress?: (pct: number) => void
  onLog?: (message: string) => void
}

export class FfmpegEngine {
  private ffmpeg: FFmpeg | null = null
  private logs: string[] = []
  private abortFlag = false

  get ready() {
    return Boolean(this.ffmpeg)
  }

  requestCancel() {
    this.abortFlag = true
    try {
      this.ffmpeg?.terminate()
    } catch {
      /* ignore */
    }
    this.ffmpeg = null
  }

  wasCancelled() {
    return this.abortFlag
  }

  async ensureLoaded(handlers: EngineHandlers = {}) {
    if (this.ffmpeg) return this.ffmpeg
    this.abortFlag = false
    const ffmpeg = new FFmpeg()
    this.logs = []
    ffmpeg.on('log', ({ message }) => {
      this.logs.push(message)
      if (this.logs.length > 100) this.logs.shift()
      handlers.onLog?.(message)
    })
    ffmpeg.on('progress', ({ progress }) => {
      if (Number.isFinite(progress)) {
        handlers.onProgress?.(Math.min(99, Math.max(0, Math.round(progress * 100))))
      }
    })
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm'
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    this.ffmpeg = ffmpeg
    return ffmpeg
  }

  async exec(args: string[]) {
    if (this.abortFlag) throw new Error('cancelled')
    const ffmpeg = this.ffmpeg
    if (!ffmpeg) throw new Error('Motore non pronto')
    this.logs = []
    const code = await ffmpeg.exec(args)
    if (this.abortFlag) throw new Error('cancelled')
    if (code !== 0) {
      throw new Error(this.logs.slice(-12).join('\n') || `FFmpeg exit ${code}`)
    }
  }

  async write(name: string, file: File | Blob) {
    const ffmpeg = this.ffmpeg
    if (!ffmpeg) throw new Error('Motore non pronto')
    await ffmpeg.writeFile(name, await fetchFile(file))
  }

  async delete(name: string) {
    try {
      await this.ffmpeg?.deleteFile(name)
    } catch {
      /* ok */
    }
  }

  async readBlob(name: string, type: string, purge: string[] = []) {
    const ffmpeg = this.ffmpeg
    if (!ffmpeg) throw new Error('Motore non pronto')
    for (const p of purge) await this.delete(p)
    await yieldUI()
    const data = await ffmpeg.readFile(name)
    const blob = blobFromU8(toU8(data), type)
    await this.delete(name)
    if (blob.size < 64) throw new Error('Output vuoto')
    return blob
  }
}

export const engine = new FfmpegEngine()
