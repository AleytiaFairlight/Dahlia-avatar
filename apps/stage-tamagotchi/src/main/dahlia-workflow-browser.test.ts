import type { AddressInfo } from 'node:net'

import type { ConnectWiseLabels, OutlookSettings } from './dahlia-workflow-browser'

import os from 'node:os'
import path from 'node:path'

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'

import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { closeDahliaWorkflowBrowser, cut, exactName, fitAnswer, folderName, isSignInPage, isTicketLink, mailKey, mailSelector, MAX_ANSWER_CHARS, runDahliaWorkflow, SIGN_IN_MARK, signInError } from './dahlia-workflow-browser'

const profile = mkdtempSync(path.join(os.tmpdir(), 'dahlia-workflow-test-'))

vi.mock('electron', () => ({
  app: { getPath: () => profile, on: vi.fn() },
  ipcMain: { handle: vi.fn() },
}))

describe('dahlia workflow browser helpers', () => {
  it('knows sign-in pages by their address', () => {
    expect(isSignInPage('https://login.microsoftonline.com/common/oauth2')).toBe(true)
    expect(isSignInPage('https://na.myconnectwise.net/v4_6_release/login/login.html')).toBe(true)
    expect(isSignInPage('https://outlook.office.com/mail/')).toBe(false)
    expect(isSignInPage('not a url')).toBe(false)
  })

  it('takes ticket links over https, or on this PC', () => {
    expect(isTicketLink('https://na.myconnectwise.net/ticket?id=1')).toBe(true)
    expect(isTicketLink('http://127.0.0.1:5000/ticket')).toBe(true)
    expect(isTicketLink('http://example.com/ticket')).toBe(false)
    expect(isTicketLink('javascript:alert(1)')).toBe(false)
  })

  it('matches whole names and folders with their unread count', () => {
    expect(exactName('New Note').test('  new note ')).toBe(true)
    expect(exactName('Save').test('Save & Close')).toBe(false)
    expect(exactName('+ Note').test('+ Note')).toBe(true)
    expect(folderName('Tickets').test('Tickets 3 unread')).toBe(true)
    expect(folderName('Tickets').test('Tickets old')).toBe(true)
    expect(folderName('Tickets').test('TicketsArchive')).toBe(false)
  })

  it('keys a message by its conversation, else by its label without the unread mark', () => {
    expect(mailKey('AQQk=', 'Unread Ticket #1', 'Unread')).toBe('conv:AQQk=')
    expect(mailKey(null, 'Unread Ticket #1', 'Unread')).toBe(mailKey(null, 'Ticket #1', 'Unread'))
    expect(mailSelector('div[role=option]', 'a"b', 0)).toBe('div[role=option][data-convid="a\\"b"]')
    expect(mailSelector('div[role=option]', null, 2)).toBe(':nth-match(div[role=option], 3)')
  })

  it('cuts text at a word and keeps answers under the server\'s limit', () => {
    expect(cut('one two three four', 9)).toBe('one two …')
    expect(cut('a\n\n\n\n b', 100)).toBe('a\n\nb')
    const answer = fitAnswer({ subject: 'x', body: 'word '.repeat(10_000) }, 'body')
    expect(JSON.stringify(answer).length).toBeLessThanOrEqual(MAX_ANSWER_CHARS)
    expect(answer.subject).toBe('x')
  })

  it('marks sign-in errors for her server', () => {
    expect(signInError('Outlook').message.startsWith(`${SIGN_IN_MARK}Outlook`)).toBe(true)
  })
})

// Outlook and ConnectWise as small pages on this PC, in Playwright's own Chromium (when it is installed).
const OUTLOOK = `<!doctype html><title>Mail</title>
<div role="tree"><div role="treeitem">Inbox</div><div role="treeitem" id="tickets">Tickets 1 unread</div></div>
<div role="listbox" aria-label="Message list"></div>
<div role="main"></div>
<script>
const list = document.querySelector('[role=listbox]')
document.getElementById('tickets').onclick = () => {
  list.innerHTML = '<div role="option" data-convid="c1" aria-label="Unread ConnectWise Ticket #123456 Impossible travel">Ticket #123456</div>'
    + '<div role="option" data-convid="c2" aria-label="Lunch on Friday?">Lunch</div>'
  list.querySelector('[data-convid=c1]').onclick = () => {
    document.querySelector('[role=main]').innerHTML = '<div role="heading">Ticket #123456 - Impossible travel</div>From: ConnectWise'
      + '<div aria-label="Message body">A new ticket. Contact: Jane Doe<br><a href="https://us.idr.insight.rapid7.com/op/x#/investigations/ABC123">Investigation</a></div>'
  }
}
</script>`

const TICKET = `<!doctype html><title>Ticket</title>
<p>Ticket #123456 Contact: Jane Doe</p>
<button>New Note</button>
<div id="notes"></div>
<script>
document.querySelector('button').onclick = () => {
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  dialog.innerHTML = '<textarea></textarea>'
    + '<label><input type="checkbox" id="d"> Discussion</label><label><input type="checkbox" id="i"> Internal</label>'
    + '<label><input type="checkbox" id="c"> Contact</label><button>Save</button>'
  document.body.append(dialog)
  dialog.querySelector('button').onclick = () => {
    const flags = ['d', 'i', 'c'].filter(id => dialog.querySelector('#' + id).checked).join(',')
    document.getElementById('notes').textContent = dialog.querySelector('textarea').value + ' [' + flags + ']'
    fetch('/saved', { method: 'POST', body: document.getElementById('notes').textContent })
    dialog.remove()
  }
}
</script>`

const LOGIN = `<!doctype html><title>Sign in</title><input type="password">`

const hasChromium = (() => {
  try {
    return existsSync(chromium.executablePath())
  }
  catch {
    return false
  }
})()

describe.skipIf(!hasChromium)('dahlia workflow browser in Chromium', () => {
  let saved = ''
  const server = createServer((request, response) => {
    if (request.url === '/saved') {
      let body = ''
      request.on('data', chunk => body += chunk)
      request.on('end', () => {
        saved = body
        response.end()
      })
      return
    }
    const page = request.url?.startsWith('/mail') ? OUTLOOK : request.url?.startsWith('/ticket') ? TICKET : LOGIN
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end(page)
  })
  let base = ''
  const browser = { channel: 'chromium', headless: true }
  const outlook = (): OutlookSettings => ({
    url: `${base}/mail/`,
    folder: 'Tickets',
    maxMessages: 10,
    selectors: {
      messageList: 'div[role=\'listbox\']',
      message: 'div[role=\'listbox\'] div[role=\'option\']',
      readingPane: 'div[role=\'main\']',
      subject: 'div[role=\'main\'] [role=\'heading\']',
      body: 'div[aria-label=\'Message body\']',
      unreadPrefix: 'Unread',
    },
  })
  const labels: ConnectWiseLabels = {
    newNoteButtons: ['Add Note', 'New Note'],
    saveButtons: ['Save'],
    discussionLabel: 'Discussion',
    internalLabel: 'Internal',
    resolutionLabel: 'Resolution',
    emailContactLabel: 'Contact',
  }

  beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await closeDahliaWorkflowBrowser()
    server.close()
    rmSync(profile, { recursive: true, force: true })
  })

  it('lists the ticket folder and opens a message', async () => {
    const listed = await runDahliaWorkflow({ op: 'mail_list', outlook: outlook(), browser })
    expect(listed.ok).toBe(true)
    const items = (listed as { answer: { items: Array<{ key: string, unread: boolean, selector: string, summary: string }> } }).answer.items
    expect(items.map(item => [item.key, item.unread])).toEqual([['conv:c1', true], ['conv:c2', false]])

    const opened = await runDahliaWorkflow({ op: 'mail_open', outlook: outlook(), selector: items[0].selector, summary: items[0].summary, browser })
    expect(opened).toMatchObject({
      ok: true,
      answer: {
        subject: 'Ticket #123456 - Impossible travel',
        links: ['https://us.idr.insight.rapid7.com/op/x#/investigations/ABC123'],
      },
    })
    expect((opened as { answer: { body: string } }).answer.body).toContain('Contact: Jane Doe')
  }, 60_000)

  it('reads a ticket, fills a note in without saving, then posts one', async () => {
    const read = await runDahliaWorkflow({ op: 'ticket_read', url: `${base}/ticket?id=123456`, browser })
    expect((read as { answer: { text: string } }).answer.text).toContain('Contact: Jane Doe')

    const filled = await runDahliaWorkflow({ op: 'ticket_note', url: `${base}/ticket?id=123456`, text: 'We checked it.', note: 'internal', emailContact: true, save: false, connectWise: labels, browser })
    expect(filled).toMatchObject({ ok: true, answer: { outcome: 'filled' } })
    expect((filled as { image?: string }).image).toMatch(/^data:image\/jpeg;base64,/)

    const posted = await runDahliaWorkflow({ op: 'ticket_note', url: `${base}/ticket?id=123456`, text: 'We checked it.', note: 'discussion', emailContact: true, save: true, connectWise: labels, browser })
    expect(posted).toMatchObject({ ok: true, answer: { outcome: 'saved', message: 'Posted to the ticket.' } })
    // Discussion and the email to the contact were ticked, Internal wasn't.
    expect(saved).toBe('We checked it. [d,c]')
  }, 60_000)

  it('says when a site wants a sign-in', async () => {
    const answer = await runDahliaWorkflow({ op: 'ticket_read', url: `${base}/login`, browser })
    expect(answer.ok).toBe(false)
    expect((answer as { error: string }).error.startsWith(`${SIGN_IN_MARK}ConnectWise`)).toBe(true)
  }, 60_000)
})
