// Dahlia: the phone's own controls, which the Android app registers and the Dahlia settings page shows:
// listening for her name in the background, and Dahlia as the phone's assistant. This file is Dahlia's
// (AIRI has no such file); apps/stage-pocket/src/dahlia-phone.ts registers the controls.

import { shallowRef } from 'vue'

export interface DahliaPhoneStatus {
  /** Listening in the background is on, so it starts again with the app. */
  backgroundListening: boolean
  /** The listening service runs now. */
  listening: boolean
  /** Dahlia is the phone's digital assistant app. */
  assistant: boolean
  /** Dahlia may display over other apps, which lets a heard "Dahlia" bring her to the front. */
  overlay: boolean
  microphone: boolean
  notifications: boolean
}

export interface DahliaPhoneControls {
  status: () => Promise<DahliaPhoneStatus>
  setBackgroundListening: (enabled: boolean) => Promise<DahliaPhoneStatus>
  openAssistantSettings: () => Promise<void>
  openOverlaySettings: () => Promise<void>
  openBatterySettings: () => Promise<void>
}

const controls = shallowRef<DahliaPhoneControls>()

export function registerDahliaPhoneControls(phone: DahliaPhoneControls) {
  controls.value = phone
}

/** The phone's controls, or undefined in an app that isn't on a phone. */
export function useDahliaPhoneControls() {
  return controls
}
