import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'

const base = process.env.RITMO_URL || 'http://127.0.0.1:4173'
const videoPath = '/tmp/ritmo-test/sample.mp4'
const audioPath = '/tmp/ritmo-test/music.mp3'

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-features=SharedArrayBuffer',
    '--disable-web-security',
  ],
})

const context = await browser.newContext()
const page = await context.newPage()

page.on('console', (msg) => console.log('CONSOLE', msg.type(), msg.text()))
page.on('pageerror', (err) => console.log('PAGEERROR', err.message))

await page.goto(base, { waitUntil: 'networkidle', timeout: 120000 })

// Wait for engine ready
await page.waitForFunction(
  () => {
    const t = document.querySelector('.status')?.textContent || ''
    return t.includes('Pronto') || t.includes('Manca') || t.includes('Carica')
  },
  { timeout: 180000 },
)

const statusBefore = await page.locator('.status').textContent()
console.log('statusBefore:', statusBefore)

const inputs = page.locator('input[type="file"]')
await inputs.nth(0).setInputFiles(videoPath)
await inputs.nth(1).setInputFiles(audioPath)

await page.waitForTimeout(500)
const btn = page.getByRole('button', { name: /Metti la musica/i })
await btn.waitFor({ state: 'visible' })
const disabled = await btn.isDisabled()
console.log('buttonDisabled:', disabled)
if (disabled) {
  console.log('status:', await page.locator('.status').textContent())
  process.exit(2)
}

await btn.click()
await page.waitForFunction(
  () => {
    const t = document.querySelector('.status')?.textContent || ''
    return t.includes('Fatto') || t.includes('fallita') || t.includes('Elaborazione fallita')
  },
  { timeout: 180000 },
)

const statusAfter = await page.locator('.status').textContent()
console.log('statusAfter:', statusAfter)

const download = page.getByRole('link', { name: /Scarica MP4/i })
const hasDownload = (await download.count()) > 0
console.log('hasDownload:', hasDownload)

const out = path.join('/tmp/ritmo-test', 'result-check.png')
await page.screenshot({ path: out, fullPage: true })
console.log('screenshot:', out)

await browser.close()

if (!hasDownload || !String(statusAfter).includes('Fatto')) {
  process.exit(1)
}
console.log('SMOKE OK')
