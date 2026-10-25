// Dahlia: tests for dahlia-device-name.ts, the name of this device for Dahlia's other devices.
import { describe, expect, it } from 'vitest'

import { dahliaDeviceName, dahliaSystemName, registerDahliaSystemName } from './dahlia-device-name'

function storage(name: string | null) {
  return { getItem: () => name }
}

describe('dahlia device name', () => {
  it('takes the chosen name, then the system name, then the fallback', () => {
    expect(dahliaDeviceName('ALEYTIA-PC', 'Windows PC', storage('Desk'))).toBe('Desk')
    expect(dahliaDeviceName('ALEYTIA-PC', 'Windows PC', storage('  '))).toBe('ALEYTIA-PC')
    expect(dahliaDeviceName(undefined, 'Phone', storage(null))).toBe('Phone')
  })

  it('treats the old default as no name, so a phone isn\'t called "Windows PC"', () => {
    expect(dahliaDeviceName('Xiaomi 14', 'Phone', storage('Windows PC'))).toBe('Xiaomi 14')
  })

  it('reads the system name the app registered', async () => {
    registerDahliaSystemName(async () => ' Xiaomi 14 ')
    expect(await dahliaSystemName()).toBe('Xiaomi 14')
    registerDahliaSystemName(async () => {
      throw new Error('no plugin')
    })
    expect(await dahliaSystemName()).toBeUndefined()
  })
})
