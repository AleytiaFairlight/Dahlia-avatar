// Dahlia: lets Dahlia on the user's other devices (the PC, and Discord for the bot owner) use this phone,
// through her server, as the desktop app offers the PC (stage-ui libs/dahlia-remote-tools.ts): for now, a
// notification on the phone. The phone offers its tools while the app runs. This file is Dahlia's (AIRI has
// no such file); src/dahlia-phone.ts starts it on Android.

import type { DahliaRemoteTool } from '@proj-airi/stage-ui/libs/dahlia-remote-tools'

import { LocalNotifications } from '@capacitor/local-notifications'
import { DahliaRemoteTools } from '@proj-airi/stage-ui/libs/dahlia-remote-tools'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { dahliaBearer, dahliaDeviceId } from '@proj-airi/stage-ui/stores/dahlia-auth'

/** The name the other devices see. */
export const DAHLIA_PHONE_NAME_KEY = 'dahlia/device-name'

/** Shows a notification on the phone, asking for the permission first when it isn't given yet. */
export async function notifyOnPhone(args: Record<string, unknown>, notifications: Pick<typeof LocalNotifications, 'checkPermissions' | 'requestPermissions' | 'schedule'> = LocalNotifications) {
  const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim().slice(0, 80) : 'Dahlia'
  const body = typeof args.text === 'string' ? args.text.trim().slice(0, 1000) : ''
  if (!body)
    throw new Error('Say what the notification should say.')

  let permission = (await notifications.checkPermissions()).display
  if (permission !== 'granted')
    permission = (await notifications.requestPermissions()).display
  if (permission !== 'granted')
    throw new Error('The phone doesn\'t allow Dahlia\'s notifications. The user can allow them in Android\'s settings.')

  await notifications.schedule({ notifications: [{ id: Math.floor(Math.random() * 2_000_000_000), title, body }] })
  return 'The notification is on the phone.'
}

export function dahliaPhoneTools(): DahliaRemoteTool[] {
  return [{
    name: 'phone_notify',
    description: 'Show a notification on the user\'s phone, such as a reminder or the result of something done on the PC.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A short title (default "Dahlia")' },
        text: { type: 'string', description: 'What the notification says' },
      },
      required: ['text'],
    },
    // It only shows something; nobody needs to confirm it on the phone.
    readOnly: true,
    run: notifyOnPhone,
  }]
}

let started = false

export function startDahliaPhoneTools() {
  if (started)
    return
  started = true
  new DahliaRemoteTools({
    serverUrl: SERVER_URL,
    getKey: () => dahliaBearer() || undefined,
    deviceId: dahliaDeviceId(),
    deviceName: () => localStorage.getItem(DAHLIA_PHONE_NAME_KEY)?.trim() || 'Phone',
    platform: 'Android',
    enabled: () => localStorage.getItem('dahlia/remote-tools-enabled') !== 'false',
    listTools: async () => dahliaPhoneTools(),
    // eslint-disable-next-line no-alert
    confirm: async tool => window.confirm(`Dahlia wants to use "${tool.name}" on this phone, for a request from another device. Allow it?`),
  }).start()
}
