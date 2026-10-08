// Prints documentation.html to PDF with headless Chrome (A4, page numbers in the footer).
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const [src, out] = process.argv.slice(2)
const profile = mkdtempSync(join(tmpdir(), 'doc-chrome-'))
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9477', '--allow-file-access-from-files', `--user-data-dir=${profile}`, 'about:blank'])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let tabs
for (let i = 0; i < 60; i++) { try { tabs = await (await fetch('http://127.0.0.1:9477/json')).json(); if (tabs.find((t) => t.type === 'page')) break } catch {} await sleep(250) }
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pending = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Page.enable')
await send('Page.navigate', { url: pathToFileURL(src).href })
await sleep(4000)
const fonts = await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => [...document.fonts].map(f => f.family + ":" + f.status).join(", "))', awaitPromise: true, returnByValue: true })
console.log('fonts:', fonts.result.result.value)
const footer = `<div style="width:100%;font-family:'Courier New',monospace;font-size:7.5px;letter-spacing:1.4px;color:#858b74;padding:0 16mm;display:flex;justify-content:space-between"><span>SIGNALSAFE · PROJECT DOCUMENTATION</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`
const r = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footer })
writeFileSync(out, Buffer.from(r.result.data, 'base64'))
console.log('wrote', out)
ws.close(); chrome.kill(); await sleep(300); try { rmSync(profile, { recursive: true, force: true }) } catch {}
