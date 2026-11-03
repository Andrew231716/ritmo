export type Lang = 'it' | 'en'

const dict = {
  it: {
    tagline: 'Comprimi, modifica e metti la musica sui tuoi video. Tutto resta sul dispositivo.',
    compress: 'Comprimi',
    music: 'Musica',
    edit: 'Modifica',
    text: 'Testo',
    convert: 'Converti',
    batch: 'Coda',
    settings: 'Impostazioni',
    video: 'Video',
    audio: 'Musica',
    dropVideo: 'Trascina o clicca · MP4, WebM, MOV',
    dropAudio: 'File MP3 / WAV / M4A (non da Spotify)',
    download: 'Scarica',
    cancel: 'Annulla',
    busy: 'Elaborazione in corso…',
    theme: 'Tema',
    language: 'Lingua',
    light: 'Chiaro',
    dark: 'Scuro',
    footer: 'Elaborazione locale con FFmpeg · i file non lasciano il browser',
  },
  en: {
    tagline: 'Compress, edit, and add music to your videos. Everything stays on your device.',
    compress: 'Compress',
    music: 'Music',
    edit: 'Edit',
    text: 'Text',
    convert: 'Convert',
    batch: 'Queue',
    settings: 'Settings',
    video: 'Video',
    audio: 'Music',
    dropVideo: 'Drop or click · MP4, WebM, MOV',
    dropAudio: 'MP3 / WAV / M4A file (not from Spotify)',
    download: 'Download',
    cancel: 'Cancel',
    busy: 'Processing…',
    theme: 'Theme',
    language: 'Language',
    light: 'Light',
    dark: 'Dark',
    footer: 'Local FFmpeg processing · files never leave your browser',
  },
} as const

export type DictKey = keyof (typeof dict)['it']

export function t(lang: Lang, key: DictKey) {
  return dict[lang][key]
}
