// Dahlia: tests for dahlia-phone-tools.ts, the phone's tools for Dahlia on the user's other devices.
import { describe, expect, it, vi } from 'vitest'

import { dahliaPhoneTools, notifyOnPhone } from './dahlia-phone-tools'

vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {} }))

function notifications(display: 'granted' | 'denied', afterRequest = display) {
  return {
    checkPermissions: vi.fn(async () => ({ display })),
    requestPermissions: vi.fn(async () => ({ display: afterRequest })),
    schedule: vi.fn(async () => ({ notifications: [] })),
  }
}

describe('dahlia phone tools', () => {
  it('shows a notification', async () => {
    const fake = notifications('granted')
    expect(await notifyOnPhone({ title: 'Done', text: 'The backup on the PC finished.' }, fake as never)).toBe('The notification is on the phone.')
    expect(fake.schedule).toHaveBeenCalledWith({ notifications: [expect.objectContaining({ title: 'Done', body: 'The backup on the PC finished.' })] })
    expect(fake.requestPermissions).not.toHaveBeenCalled()
  })

  it('asks for the permission, and says so when it isn\'t given', async () => {
    const fake = notifications('denied')
    await expect(notifyOnPhone({ text: 'Hi' }, fake as never)).rejects.toThrow('doesn\'t allow')
    expect(fake.requestPermissions).toHaveBeenCalledOnce()
    expect(fake.schedule).not.toHaveBeenCalled()
  })

  it('needs a text', async () => {
    await expect(notifyOnPhone({ title: 'x' }, notifications('granted') as never)).rejects.toThrow('Say what')
  })

  it('offers the notification as a tool that needs no confirmation', () => {
    expect(dahliaPhoneTools().map(tool => [tool.name, tool.readOnly])).toEqual([['phone_notify', true]])
  })
})
