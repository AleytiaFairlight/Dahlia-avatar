import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FLOATING_PICTURE_SIZE, useDahliaFloatingPictures } from './dahlia-floating-pictures'

const addWidget = vi.fn(async () => 'widget-1')

vi.mock('@proj-airi/electron-vueuse', () => ({ useElectronEventaInvoke: () => addWidget }))

const stored = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  clear: () => stored.clear(),
})

describe('dahlia floating pictures', () => {
  beforeEach(() => {
    addWidget.mockClear()
    localStorage.clear()
  })

  it('opens each picture of her reply as a widget on top', async () => {
    await useDahliaFloatingPictures().fromReply('Here!\n\n![a fox](https://hub.local/api/v1/dahlia/images/f-1.png)\n\n![a cat](https://hub.local/api/v1/dahlia/images/c-2.png)')

    expect(addWidget).toHaveBeenCalledTimes(2)
    expect(addWidget).toHaveBeenCalledWith({
      componentName: 'dahlia-picture',
      componentProps: { src: 'https://hub.local/api/v1/dahlia/images/f-1.png', caption: 'a fox' },
      windowSize: FLOATING_PICTURE_SIZE,
      alwaysOnTop: true,
      ttlMs: 0,
    })
  })

  it('leaves her reply alone when the person turned it off or there is no picture', async () => {
    await useDahliaFloatingPictures().fromReply('Just words, ![not hers](https://example.com/x.png).')
    localStorage.setItem('dahlia/float-pictures', 'false')
    await useDahliaFloatingPictures().fromReply('![a fox](https://hub.local/api/v1/dahlia/images/f-1.png)')

    expect(addWidget).not.toHaveBeenCalled()
  })
})
