// Dahlia: connects the Android side of her phone features (android/.../dahlia/DahliaPlugin.kt) to the web
// app. When Android opens her as the phone's assistant, or her background listening hears her name, the
// app starts a voice input as if she had heard it. It also offers the phone's tools to her other devices. This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh calls startDahliaPhone() after the app starts.

import type { PluginListenerHandle } from '@capacitor/core'
import type { DahliaPhoneStatus } from '@proj-airi/stage-ui/libs/dahlia-phone'

import { App } from '@capacitor/app'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { registerDahliaSystemName } from '@proj-airi/stage-ui/libs/dahlia-device-name'
import { registerDahliaPhoneControls } from '@proj-airi/stage-ui/libs/dahlia-phone'
import { requestDahliaWake } from '@proj-airi/stage-ui/stores/dahlia-external-wake'

import { startDahliaPhoneTools } from './dahlia-phone-tools'

interface DahliaPlugin {
  consumeWake: () => Promise<{ wake: boolean }>
  getDeviceName: () => Promise<{ name: string }>
  getStatus: () => Promise<DahliaPhoneStatus>
  setBackgroundListening: (options: { enabled: boolean }) => Promise<DahliaPhoneStatus>
  openAssistantSettings: () => Promise<void>
  openOverlaySettings: () => Promise<void>
  openBatterySettings: () => Promise<void>
  addListener: (event: 'wake', listener: () => void) => Promise<PluginListenerHandle>
}

const Dahlia = registerPlugin<DahliaPlugin>('Dahlia')

/** Starts a voice input when Android or the listening service opened the app to listen. */
export async function takeDahliaWake(plugin: Pick<DahliaPlugin, 'consumeWake'> = Dahlia, wake: () => void = requestDahliaWake) {
  try {
    if ((await plugin.consumeWake()).wake)
      wake()
  }
  catch (error) {
    console.warn('Dahlia: could not read the wake request', error)
  }
}

/** Android only: registers the phone's controls and takes wakes now, when they come and on resume. */
export async function startDahliaPhone() {
  if (Capacitor.getPlatform() !== 'android')
    return

  registerDahliaPhoneControls({
    status: () => Dahlia.getStatus(),
    setBackgroundListening: enabled => Dahlia.setBackgroundListening({ enabled }),
    openAssistantSettings: () => Dahlia.openAssistantSettings(),
    openOverlaySettings: () => Dahlia.openOverlaySettings(),
    openBatterySettings: () => Dahlia.openBatterySettings(),
  })

  // The phone's name in Android's settings is its name for her other devices, unless Settings > Dahlia sets one.
  registerDahliaSystemName(async () => (await Dahlia.getDeviceName()).name)
  // Her other devices may use this phone (a notification), through her server.
  startDahliaPhoneTools()

  await Dahlia.addListener('wake', () => void takeDahliaWake())
  await App.addListener('resume', () => void takeDahliaWake())
  await takeDahliaWake()
}
