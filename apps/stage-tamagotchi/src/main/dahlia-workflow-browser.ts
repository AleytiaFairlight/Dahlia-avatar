// Dahlia: her browser for the owner's ticket work, on the "dahlia:workflow" channel. Her server (the Avatar hub's
// Gateway/Workflows.cs, with src/Dahlia.Workflows) decides what to do and calls the "workflow_*" tools of
// src/renderer/dahlia-remote-tools.ts, which come here: Google Chrome, driven with Playwright, in a profile of
// Dahlia's own (the owner signs in to Outlook and ConnectWise there once, from Settings > Modules > Tickets). It
// reads the ticket mail in Outlook on the web and the tickets in ConnectWise Manage, and adds a note to a ticket
// once the owner approved it. The server sends the settings (where things are on the pages) with every call, so
// none are kept here. Her chat never sees these tools. This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh calls setupDahliaWorkflowBrowser() when the main process starts.

import type { BrowserContext, Frame, Locator, Page } from 'playwright-core'

import path from 'node:path'

import { createHash } from 'node:crypto'

import { errorMessageFrom } from '@moeru/std'
import { app, ipcMain } from 'electron'

export const DAHLIA_WORKFLOW_CHANNEL = 'dahlia:workflow'

/** How her server learns that a site sent the browser to its sign-in page (Gateway/Workflows.cs, SIGN_IN_MARK). */
export const SIGN_IN_MARK = 'SIGNIN:'

/** Her server keeps 16,000 characters of a result: answers stay under this so their JSON is never cut. */
export const MAX_ANSWER_CHARS = 15_000

const LOAD_TIMEOUT_MS = 60_000
const TICKET_LOAD_TIMEOUT_MS = 90_000

export interface WorkflowBrowserSettings { channel?: string, headless?: boolean }

export interface OutlookSelectors {
  messageList: string
  message: string
  readingPane: string
  subject: string
  body: string
  unreadPrefix: string
}

export interface OutlookSettings {
  url: string
  folder?: string
  maxMessages?: number
  selectors: OutlookSelectors
}

export interface ConnectWiseLabels {
  newNoteButtons: string[]
  saveButtons: string[]
  discussionLabel: string
  internalLabel: string
  resolutionLabel: string
  emailContactLabel: string
}

export type DahliaWorkflowRequest
  = | { op: 'signin', urls: string[], browser?: WorkflowBrowserSettings }
    | { op: 'mail_list', outlook: OutlookSettings, browser?: WorkflowBrowserSettings }
    | { op: 'mail_open', outlook: OutlookSettings, selector: string, summary?: string, browser?: WorkflowBrowserSettings }
    | { op: 'ticket_read', url: string, browser?: WorkflowBrowserSettings }
    | { op: 'ticket_note', url: string, text: string, note: string, emailContact: boolean, save: boolean, connectWise: ConnectWiseLabels, browser?: WorkflowBrowserSettings }

export type DahliaWorkflowResult
  = | { ok: true, answer: Record<string, unknown>, image?: string }
    | { ok: false, error: string }

/** The error that tells her server to have the owner sign in again. */
export function signInError(site: string) {
  return new Error(`${SIGN_IN_MARK}${site} wants you to sign in again: press Sign in on the Tickets page (Settings > Modules > Tickets).`)
}

/** A sign-in page, by its address: Microsoft's login hosts, or a /login path. */
export function isSignInPage(url: string) {
  try {
    const { hostname, pathname } = new URL(url)
    return hostname.startsWith('login.') || hostname.includes('microsoftonline') || pathname.toLowerCase().includes('/login')
  }
  catch {
    return false
  }
}

export function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The whole text of a label or button, ignoring case and the spaces around it. */
export function exactName(name: string) {
  return new RegExp(`^\\s*${escapeRegExp(name.trim())}\\s*$`, 'i')
}

/** Outlook names a folder with its unread count ("Tickets 3 unread"): the start of the name matches. */
export function folderName(folder: string) {
  return new RegExp(`^${escapeRegExp(folder.trim())}(\\s|$)`, 'i')
}

/** A message's key: Outlook's conversation id, or a hash of its label without the unread mark. */
export function mailKey(convId: string | null, label: string, unreadPrefix: string) {
  if (convId)
    return `conv:${convId}`
  const read = label.toLowerCase().startsWith(unreadPrefix.toLowerCase()) ? label.slice(unreadPrefix.length).trim() : label
  return `label:${createHash('sha256').update(read).digest('hex').slice(0, 24)}`
}

/** Finds the message again: by its conversation id, or by its place in the list. */
export function mailSelector(messageSelector: string, convId: string | null, index: number) {
  return convId
    ? `${messageSelector}[data-convid="${convId.replace(/["\\]/g, '\\$&')}"]`
    : `:nth-match(${messageSelector}, ${index + 1})`
}

/** Text in one paragraph-tidy piece, cut at a word to at most max characters. */
export function cut(text: string | undefined, max: number) {
  const tidy = (text ?? '').replace(/\n\s*\n\s*\n\s*/g, '\n\n').trim()
  if (tidy.length <= max)
    return tidy
  const piece = tidy.slice(0, max)
  const space = piece.lastIndexOf(' ')
  return `${space > max * 0.75 ? piece.slice(0, space) : piece} …`
}

/** The answer shortened (its longest text first) until its JSON fits her server's result. */
export function fitAnswer(answer: Record<string, unknown>, field: string) {
  let json = JSON.stringify(answer)
  while (json.length > MAX_ANSWER_CHARS && typeof answer[field] === 'string' && (answer[field] as string).length > 0) {
    const text = answer[field] as string
    answer[field] = cut(text, Math.max(0, text.length - (json.length - MAX_ANSWER_CHARS) - 200))
    json = JSON.stringify(answer)
  }
  return answer
}

let context: BrowserContext | undefined
const pages = new Map<string, Page>()
let queue: Promise<unknown> = Promise.resolve()

function profileDir() {
  return path.join(app.getPath('userData'), 'dahlia-workflow-chrome')
}

/** Chrome with her profile, started on first use; a running one is kept (a sign-in window stays open). */
async function browserContext(settings: WorkflowBrowserSettings | undefined, headed = false) {
  if (context)
    return context
  const { chromium } = await import('playwright-core')
  const headless = headed ? false : settings?.headless === true
  const channel = settings?.channel?.trim() || 'chrome'
  const started = await chromium.launchPersistentContext(profileDir(), {
    // "chromium": Playwright's own browser, for tests; the PC uses Chrome.
    channel: channel === 'chromium' ? undefined : channel,
    headless,
    viewport: headless ? { width: 1440, height: 960 } : null,
  })
  started.on('close', () => {
    if (context === started) {
      context = undefined
      pages.clear()
    }
  })
  context = started
  return started
}

/** The site's tab, opened again when it was closed. */
async function sitePage(site: string, settings?: WorkflowBrowserSettings) {
  const known = pages.get(site)
  if (known && !known.isClosed())
    return known
  const browser = await browserContext(settings)
  const blank = browser.pages().find(page => page.url() === 'about:blank' && ![...pages.values()].includes(page))
  const page = blank ?? await browser.newPage()
  pages.set(site, page)
  return page
}

async function waitForList(page: Page, selectors: OutlookSelectors) {
  try {
    // There, not shown: an empty folder's list has no height.
    await page.locator(selectors.messageList).first().waitFor({ state: 'attached', timeout: LOAD_TIMEOUT_MS })
  }
  catch {
    if (isSignInPage(page.url()))
      throw signInError('Outlook')
    throw new Error(`Outlook's mail list didn't show within a minute (outlook.selectors.messageList: ${selectors.messageList}).`)
  }
}

/** Outlook, fresh, in the ticket folder: a tab left open for days can stop updating. */
async function outlookFolder(outlook: OutlookSettings, settings?: WorkflowBrowserSettings) {
  const page = await sitePage('outlook', settings)
  await page.goto(outlook.url, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS })
  await waitForList(page, outlook.selectors)
  const folder = outlook.folder?.trim()
  if (folder && folder.toLowerCase() !== 'inbox') {
    const item = page.getByRole('treeitem', { name: folderName(folder) })
    if (await item.count() === 0)
      throw new Error(`Outlook has no folder "${folder}" in its folder list.`)
    await item.first().click()
    await page.waitForTimeout(2_000)
    await waitForList(page, outlook.selectors)
  }
  return page
}

async function mailList(outlook: OutlookSettings, settings?: WorkflowBrowserSettings) {
  const page = await outlookFolder(outlook, settings)
  const { selectors } = outlook
  const messages = page.locator(selectors.message)
  const count = Math.min(await messages.count(), Math.max(1, Math.min(outlook.maxMessages ?? 20, 50)))
  const items: Array<{ key: string, summary: string, unread: boolean, selector: string }> = []
  for (let i = 0; i < count; i++) {
    const message = messages.nth(i)
    // eslint-disable-next-line unicorn/prefer-dom-node-text-content -- Playwright's innerText(): the text as shown
    const label = ((await message.getAttribute('aria-label')) ?? await message.innerText()).trim()
    const convId = await message.getAttribute('data-convid')
    items.push({
      key: mailKey(convId, label, selectors.unreadPrefix),
      summary: cut(label, 300),
      unread: label.toLowerCase().startsWith(selectors.unreadPrefix.toLowerCase()),
      selector: mailSelector(selectors.message, convId, i),
    })
  }
  return { items }
}

async function firstText(locator: Locator) {
  try {
    // eslint-disable-next-line unicorn/prefer-dom-node-text-content -- Playwright's innerText(): the text as shown
    return await locator.count() > 0 ? await locator.first().innerText({ timeout: 3_000 }) : undefined
  }
  catch {
    return undefined
  }
}

async function mailOpen(outlook: OutlookSettings, selector: string, summary: string | undefined, settings?: WorkflowBrowserSettings) {
  let page = await sitePage('outlook', settings)
  // The list from this scan is still open; after a restart the folder opens again.
  if (await page.locator(selector).count() === 0)
    page = await outlookFolder(outlook, settings)
  await page.locator(selector).first().click({ timeout: 15_000 })
  const body = page.locator(outlook.selectors.body)
  await body.first().waitFor({ timeout: 30_000 })
  await page.waitForTimeout(800)

  const subject = await firstText(page.locator(outlook.selectors.subject)) ?? summary ?? ''
  const pane = await firstText(page.locator(outlook.selectors.readingPane)) ?? ''
  const texts = await body.allInnerTexts()
  const links = await page.locator(`${outlook.selectors.body} a[href]`).evaluateAll(anchors => anchors.map(anchor => (anchor as HTMLAnchorElement).href))
  return fitAnswer({
    subject: cut(subject, 500),
    header: cut(pane, 1_000),
    links: [...new Set(links.filter(link => /^https?:/i.test(link)))].slice(0, 30).map(link => link.slice(0, 400)),
    body: cut(texts.join('\n\n'), 12_000),
  }, 'body')
}

/** ConnectWise keeps loading after the page is there. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined)
  await page.waitForTimeout(1_500)
}

/** ConnectWise over https, or a page on this PC (tests). */
export function isTicketLink(url: string) {
  return /^https:\/\//i.test(url) || /^http:\/\/127\.0\.0\.1[:/]/.test(url)
}

async function ticketPage(url: string, settings?: WorkflowBrowserSettings) {
  if (!isTicketLink(url))
    throw new Error('The ticket link must start with https://.')
  const page = await sitePage('connectwise', settings)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TICKET_LOAD_TIMEOUT_MS })
  await settle(page)
  if (isSignInPage(page.url()) || await page.locator('input[type=password]:visible').count() > 0)
    throw signInError('ConnectWise')
  return page
}

/** The page's text, its frames included. */
async function allText(page: Page) {
  const parts: string[] = []
  for (const frame of page.frames()) {
    // eslint-disable-next-line unicorn/prefer-dom-node-text-content -- Playwright's innerText(): the text as shown
    const text = await frame.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
    if (text.trim())
      parts.push(text)
  }
  return parts.join('\n\n')
}

/** The note's text box: the last visible text area or rich text editor, in any frame. */
async function noteEditor(page: Page) {
  for (let tries = 0; tries < 15; tries++) {
    for (const frame of page.frames()) {
      const box = frame.locator('textarea:visible, [contenteditable="true"]:visible')
      if (await box.count() > 0)
        return box.last()
    }
    await page.waitForTimeout(1_000)
  }
  throw new Error('No text box for the note showed after pressing New Note.')
}

/** The frame with the note's dialog, so "Contact" means the note's box, not the ticket's field. */
async function noteFrame(page: Page) {
  for (const frame of page.frames()) {
    if (await frame.locator('[role="dialog"]:visible').count() > 0)
      return frame
  }
  return page.mainFrame()
}

async function clickIn(frame: Frame, names: string[]) {
  const dialog = frame.locator('[role="dialog"]:visible')
  const root = await dialog.count() > 0 ? dialog.last() : frame.locator('body')
  for (const name of names.filter(name => name.trim())) {
    for (const candidate of [root.getByRole('button', { name: exactName(name) }), root.getByText(exactName(name))]) {
      const visible = candidate.locator('visible=true')
      if (await visible.count() > 0) {
        await visible.first().click({ timeout: 10_000 })
        return true
      }
    }
  }
  return false
}

async function clickAny(page: Page, names: string[], what: string) {
  for (const frame of page.frames()) {
    if (await clickIn(frame, names))
      return
  }
  throw new Error(`Couldn't find ${what}: tried ${names.join(', ')}.`)
}

/** Ticks the box with the label; says so when it could only click the label's text. */
async function tick(frame: Frame, label: string) {
  if (!label.trim())
    return []
  const dialog = frame.locator('[role="dialog"]:visible')
  const root = await dialog.count() > 0 ? dialog.last() : frame.locator('body')
  let box = root.getByRole('checkbox', { name: exactName(label) }).locator('visible=true')
  if (await box.count() === 0)
    box = root.getByLabel(exactName(label)).locator('visible=true')
  if (await box.count() > 0) {
    try {
      await box.first().check({ timeout: 5_000 })
      return []
    }
    catch {
      // Not a real checkbox: its text below.
    }
  }
  const text = root.getByText(exactName(label)).locator('visible=true')
  if (await text.count() === 0)
    return [`Found no "${label}" box.`]
  await text.first().click({ timeout: 5_000 })
  return [`Clicked "${label}" by its text: check it is ticked.`]
}

async function screenshot(page: Page) {
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 70 })
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`
}

function tidySpaces(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

async function ticketNote(request: Extract<DahliaWorkflowRequest, { op: 'ticket_note' }>) {
  const { connectWise: labels } = request
  const page = await ticketPage(request.url, request.browser)
  await clickAny(page, labels.newNoteButtons, 'the New Note button (connectWise.newNoteButtons)')
  await (await noteEditor(page)).fill(request.text)

  const frame = await noteFrame(page)
  const kind = request.note === 'internal' ? labels.internalLabel : request.note === 'resolution' ? labels.resolutionLabel : labels.discussionLabel
  const remarks = [...await tick(frame, kind), ...(request.emailContact ? await tick(frame, labels.emailContactLabel) : [])]
  const said = remarks.length ? ` ${remarks.join(' ')}` : ''
  if (!request.save)
    return { answer: { outcome: 'filled', message: `Filled in without pressing Save (dry run is on): check the screenshot.${said}` }, image: await screenshot(page) }

  if (!await clickIn(frame, labels.saveButtons))
    await clickAny(page, labels.saveButtons, 'the Save button (connectWise.saveButtons)')
  await settle(page)
  const start = tidySpaces(request.text).slice(0, 60).toLowerCase()
  const shown = tidySpaces(await allText(page)).toLowerCase().includes(start)
  return {
    answer: shown
      ? { outcome: 'saved', message: `Posted to the ticket.${said}` }
      : { outcome: 'unconfirmed', message: `Pressed Save, but the note didn't show on the ticket: check the ticket and the screenshot.${said}` },
    image: await screenshot(page),
  }
}

/** Opens the sites in a window for the owner to sign in; the window stays for her later calls. */
async function signIn(urls: string[], settings?: WorkflowBrowserSettings) {
  const browser = await browserContext(settings, true)
  for (const url of urls.filter(url => /^https:\/\//i.test(url))) {
    const page = browser.pages().find(open => open.url() === 'about:blank') ?? await browser.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS }).catch(() => undefined)
    await page.bringToFront().catch(() => undefined)
  }
  return { opened: urls.length }
}

export async function runDahliaWorkflow(request: DahliaWorkflowRequest): Promise<DahliaWorkflowResult> {
  // One browser: her steps take turns.
  const step = queue.then(async () => {
    switch (request.op) {
      case 'signin':
        return { answer: await signIn(request.urls ?? [], request.browser) }
      case 'mail_list':
        return { answer: await mailList(request.outlook, request.browser) }
      case 'mail_open':
        return { answer: await mailOpen(request.outlook, request.selector, request.summary, request.browser) }
      case 'ticket_read':
        return { answer: fitAnswer({ text: cut(await allText(await ticketPage(request.url, request.browser)), 12_000) }, 'text') }
      case 'ticket_note':
        return await ticketNote(request)
      default:
        throw new Error('Unknown workflow step.')
    }
  })
  queue = step.catch(() => undefined)
  try {
    const { answer, image } = await step as { answer: Record<string, unknown>, image?: string }
    return { ok: true, answer, ...(image ? { image } : {}) }
  }
  catch (error) {
    const message = errorMessageFrom(error) ?? 'The step failed.'
    // A missing Chrome reads better than Playwright's own text.
    return { ok: false, error: /executable doesn't exist|chromium distribution/i.test(message) ? 'Google Chrome isn\'t installed on this PC.' : message.split('\n')[0] }
  }
}

/** Closes her Chrome (when the app quits). */
export async function closeDahliaWorkflowBrowser() {
  const open = context
  context = undefined
  pages.clear()
  await open?.close().catch(() => undefined)
}

export function setupDahliaWorkflowBrowser() {
  ipcMain.handle(DAHLIA_WORKFLOW_CHANNEL, (_event, request: DahliaWorkflowRequest) => runDahliaWorkflow(request))
  app.on('before-quit', () => void closeDahliaWorkflowBrowser())
}
