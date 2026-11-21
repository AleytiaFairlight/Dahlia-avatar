import type { DahliaBackseatDeps } from './dahlia-backseat'

import { describe, expect, it, vi } from 'vitest'

import { pointOnScreen } from './dahlia-backseat'

function deps(overrides: Partial<DahliaBackseatDeps> = {}) {
  const requests: Array<Record<string, unknown>> = []
  const point = vi.fn(async () => ({ ok: true }))
  const all: DahliaBackseatDeps = {
    windowRequest: async (request) => {
      requests.push(request)
      switch (request.op) {
        case 'foreground': return { hwnd: 7, title: 'Hollow Knight' }
        case 'find': return { hwnd: 9, title: 'Stardew Valley' }
        case 'capture': return { png: 'AAAA', words: '[{"t":"Inventory","x":100,"y":200,"w":80,"h":20,"l":0}]' }
        case 'frame': return { left: 1000, top: 500, width: 800, height: 600 }
        default: return {}
      }
    },
    locate: vi.fn(async () => ({ x: 250, y: 500, by: 'text' })),
    ownInFront: async () => false,
    point,
    ...overrides,
  }
  return { all, requests, point }
}

describe('dahlia backseat', () => {
  it('points at the target in the window in front, where it is on the screen', async () => {
    const { all, requests, point } = deps()

    const said = await pointOnScreen({ target: 'Inventory', label: 'here!' }, all)

    expect(requests.map(request => request.op)).toEqual(['foreground', 'capture', 'frame'])
    expect(all.locate).toHaveBeenCalledWith('Inventory', 'AAAA', [{ t: 'Inventory', x: 100, y: 200, w: 80, h: 20, l: 0 }], '')
    expect(point).toHaveBeenCalledWith({ x: 1200, y: 800, label: 'here!', ms: 7000 })
    expect(said).toContain('Pointed at "Inventory" in "Hollow Knight" by its text')
  })

  it('finds a named window, and asks for one while her own chat is in front', async () => {
    const named = deps({ ownInFront: async () => true })
    expect(await pointOnScreen({ target: 'the chest' }, named.all)).toContain('Your own chat is in front')
    expect(named.point).not.toHaveBeenCalled()

    await pointOnScreen({ target: 'the chest', window: 'Stardew' }, named.all)
    expect(named.requests[0]).toEqual({ op: 'find', title: 'Stardew', anyApp: true })
    expect(named.point).toHaveBeenCalledOnce()
  })

  it('says so when the target isn\'t found', async () => {
    const missing = deps({ locate: async () => undefined })
    expect(await pointOnScreen({ target: 'the boss door' }, missing.all)).toContain('You couldn\'t find "the boss door"')
    expect(missing.point).not.toHaveBeenCalled()
  })
})
