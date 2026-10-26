import { chromium } from 'playwright'
import path from 'node:path'

const base = process.env.RITMO_URL || 'http://127.0.0.1:4173'
const videoPath = '/tmp/ritmo-test/sample.mp4'
const audioPath = '/tmp/ritmo-test/music.mp3'

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext()).newPage()

page.on('console', (msg) => console.log('CONSOLE', msg.type(), msg.text()))
page.on('pageerror', (err) => console.log('PAGEERROR', err.message))

await page.goto(base, { waitUntil: 'networkidle', timeout: 120000 })

await page.waitForFunction(
  () => {
    const t = document.querySelector('.status')?.textContent || ''
    return /Pronto|Carica|Manca|Comprimi|Motore/.test(t)
  },
  { timeout: 180000 },
)

console.log('brand:', await page.locator('.brand-name').textContent())
console.log('status:', await page.locator('.status').textContent())

// --- Compress mode ---
await page.locator('input[type="file"]').first().setInputFiles(videoPath)
await page.getByRole('button', { name: /Comprimi video/i }).click()
await page.waitForFunction(
  () => /Fatto|fallita|Compressione fallita/.test(document.querySelector('.status')?.textContent || ''),
  { timeout: 180000 },
)
const compressStatus = await page.locator('.status').textContent()
console.log('compressStatus:', compressStatus)
const compressOk = String(compressStatus).includes('Fatto')
console.log('compressOk:', compressOk)

// --- Music mode ---
await page.getByRole('tab', { name: 'Musica' }).click()
await page.locator('input[type="file"]').nth(0).setInputFiles(videoPath)
await page.locator('input[type="file"]').nth(1).setInputFiles(audioPath)
const mixBtn = page.getByRole('button', { name: /Metti la musica/i })
await mixBtn.click()
await page.waitForFunction(
  () => /Fatto|fallita|Elaborazione fallita/.test(document.querySelector('.status')?.textContent || ''),
  { timeout: 180000 },
)
const mixStatus = await page.locator('.status').textContent()
console.log('mixStatus:', mixStatus)
const mixOk = String(mixStatus).includes('Fatto')

await page.screenshot({ path: path.join('/tmp/ritmo-test', 'nastro-check.png'), fullPage: true })
await browser.close()

if (!compressOk || !mixOk) process.exit(1)
console.log('SMOKE OK')
