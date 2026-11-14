import { useElectronRelativeMouse } from '@proj-airi/electron-vueuse'
import { useWindowSize } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'

export const useWindowStore = defineStore('tamagotchi-window', () => {
  const { width, height } = useWindowSize()
  const centerPos = computed(() => ({ x: width.value / 2, y: height.value / 2 }))

  // Use window-relative mouse coordinates for the avatar's gaze
  // Transforms screen coordinates to window-relative coordinates
  const { x: lookAtX, y: lookAtY } = useElectronRelativeMouse({ initialValue: centerPos.value })

  return {
    width,
    height,
    centerPos,
    lookAtX,
    lookAtY,
  }
})
