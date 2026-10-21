// @vitest-environment jsdom
// Dahlia: tests for dahlia-network.ts, which keeps the Android app on Dahlia's server.
import { describe, expect, it } from 'vitest'

import { dahliaContentSecurityPolicy, installDahliaContentSecurityPolicy } from './dahlia-network'

describe('dahlia android network', () => {
  it('allows only the app itself and Dahlia\'s server, and GitHub\'s API for requests', () => {
    const policy = dahliaContentSecurityPolicy('https://dahlia.aleytia.moe')

    expect(policy).toContain('connect-src \'self\' blob: data: https://dahlia.aleytia.moe wss://dahlia.aleytia.moe https://api.github.com;')
    for (const directive of ['img-src', 'media-src', 'font-src'])
      expect(policy).toContain(`${directive} 'self' blob: data: https://dahlia.aleytia.moe wss://dahlia.aleytia.moe`)
    expect(policy.match(/https:\/\/api\.github\.com/g)).toHaveLength(1)
    expect(policy).not.toMatch(/\*|jsdelivr|https:(?!\/\/(?:dahlia|api\.github\.com))/)
  })

  it('uses plain WebSockets for a plain HTTP test server', () => {
    expect(dahliaContentSecurityPolicy('http://127.0.0.1:16130')).toContain('http://127.0.0.1:16130 ws://127.0.0.1:16130')
  })

  it('puts the policy first in the page head', () => {
    document.head.innerHTML = '<title>Dahlia</title>'

    installDahliaContentSecurityPolicy(document, 'https://dahlia.aleytia.moe')

    const meta = document.head.firstElementChild as HTMLMetaElement
    expect(meta.httpEquiv).toBe('Content-Security-Policy')
    expect(meta.content).toBe(dahliaContentSecurityPolicy('https://dahlia.aleytia.moe'))
  })
})
