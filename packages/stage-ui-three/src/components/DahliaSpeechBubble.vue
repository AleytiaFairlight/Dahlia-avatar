<script setup lang="ts">
// Dahlia: the speech bubble at her 3D avatar's head (dahlia-speech-bubble.ts). A sprite in the scene, like the presence
// bubble: painted on a canvas, placed above her head on the side with room, with its tail toward her. Its edge takes
// the color of the feeling she shows, with a small heart, raindrop, star, spark or dots. Desktop app only.
// This file is Dahlia's (AIRI has no such file).
import type { PresenceBubblePalette } from '@proj-airi/stage-shared'
import type { PerspectiveCamera, Vector3 } from 'three'

import type { DahliaBubbleMood } from './dahlia-speech-bubble'

import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { useLoop, useTresContext } from '@tresjs/core'
import { usePreferredReducedMotion } from '@vueuse/core'
import { CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace, Vector3 as ThreeVector3 } from 'three'
import { inject, onMounted, onUnmounted, shallowRef } from 'vue'

import {
  BUBBLE_FONT_PX,
  BUBBLE_LINE_PX,
  BUBBLE_LINGER_MS,
  BUBBLE_MAX_LINES,
  BUBBLE_MAX_WIDTH,
  BUBBLE_MOODS,
  BUBBLE_PADDING_PX,
  BUBBLE_TAIL_PX,
  bubblePartMs,
  bubbleParts,
  dahliaSpeechBubbleEnabled,
  onDahliaBubble,
  placeBubble,
  wrapBubbleText,
} from './dahlia-speech-bubble'
import { presenceBubblePaletteKey } from './presence-bubble-palette'

const props = withDefaults(defineProps<{
  /** Head position and reach in world space, or `undefined` while no model is loaded. */
  headAnchor: () => { position: Vector3, radius: number } | undefined
  /** Device pixels per screen unit. */
  resolution?: number
}>(), { resolution: 2 })

const { camera, scene, sizes } = useTresContext()
const activeCamera = camera.activeCamera
const { onBeforeRender } = useLoop()
const preferredMotion = usePreferredReducedMotion()
const readPalette = inject(presenceBubblePaletteKey)
const fallbackPalette: PresenceBubblePalette = { panel: '#fafafa', shadow: '#171717', ink: '#404040', badge: '#404040', badgeInk: '#fafafa' }

/** The canvas holds the largest bubble; a smaller one is painted in its top left. */
const SIGN_PX = 16
const CANVAS_WIDTH = BUBBLE_MAX_WIDTH + 8
const CANVAS_HEIGHT = BUBBLE_PADDING_PX * 2 + BUBBLE_MAX_LINES * BUBBLE_LINE_PX + BUBBLE_TAIL_PX + 8
const FONT = `${BUBBLE_FONT_PX}px system-ui, -apple-system, "Segoe UI", sans-serif`

const canvas = document.createElement('canvas')
const context = canvas.getContext('2d')
const sprite = shallowRef<Sprite>()

let lines: string[] = []
let mood: DahliaBubbleMood | undefined
let size = { width: 0, height: 0 }
let paintedTail: 'left' | 'right' | undefined
let dirty = false
let opacity = 0
let target = 0
let partTimer: ReturnType<typeof setTimeout> | undefined
let hideTimer: ReturnType<typeof setTimeout> | undefined
let stopListening: (() => void) | undefined

/** Sets the text and measures the bubble it needs. */
function show(text: string) {
  if (!context)
    return
  context.font = FONT
  // Room for the feeling's sign is kept always: the feeling often comes after the words.
  lines = wrapBubbleText(text, line => context.measureText(line).width, BUBBLE_MAX_WIDTH - BUBBLE_PADDING_PX * 2 - SIGN_PX)
  const widest = Math.max(...lines.map(line => context.measureText(line).width))
  size = { width: Math.min(BUBBLE_MAX_WIDTH, Math.ceil(widest) + BUBBLE_PADDING_PX * 2 + SIGN_PX), height: BUBBLE_PADDING_PX * 2 + lines.length * BUBBLE_LINE_PX }
  dirty = true
  target = 1
}

function drawSign(kind: NonNullable<(typeof BUBBLE_MOODS)[DahliaBubbleMood]['sign']>, x: number, y: number, color: string) {
  if (!context)
    return
  context.save()
  context.fillStyle = color
  context.strokeStyle = color
  context.lineWidth = 1.5
  context.beginPath()
  switch (kind) {
    case 'heart':
      context.moveTo(x, y + 3)
      context.bezierCurveTo(x - 6, y - 3, x - 2, y - 7, x, y - 3)
      context.bezierCurveTo(x + 2, y - 7, x + 6, y - 3, x, y + 3)
      context.fill()
      break
    case 'drop':
      context.moveTo(x, y - 6)
      context.quadraticCurveTo(x + 5, y + 1, x, y + 4)
      context.quadraticCurveTo(x - 5, y + 1, x, y - 6)
      context.fill()
      break
    case 'star':
      for (let point = 0; point < 10; point++) {
        const radius = point % 2 === 0 ? 6 : 2.5
        const angle = Math.PI / 5 * point - Math.PI / 2
        context.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)
      }
      context.closePath()
      context.fill()
      break
    case 'spark':
      for (const [dx, dy] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) {
        context.moveTo(x + dx * 0.3, y + dy * 0.3)
        context.lineTo(x + dx, y + dy)
      }
      context.stroke()
      break
    case 'dots':
      for (const dx of [-5, 0, 5]) {
        context.moveTo(x + dx + 1.5, y)
        context.arc(x + dx, y, 1.5, 0, Math.PI * 2)
      }
      context.fill()
      break
  }
  context.restore()
}

function paint(tail: 'left' | 'right') {
  if (!context)
    return
  const scale = props.resolution
  if (canvas.width !== CANVAS_WIDTH * scale || canvas.height !== CANVAS_HEIGHT * scale) {
    canvas.width = CANVAS_WIDTH * scale
    canvas.height = CANVAS_HEIGHT * scale
  }
  const palette = readPalette?.() ?? fallbackPalette
  const edge = mood ? BUBBLE_MOODS[mood].edge : palette.shadow
  const { width, height } = size
  const x = 2
  const y = 2
  context.setTransform(scale, 0, 0, scale, 0, 0)
  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

  // The body, with the tail leaving its bottom edge near the head's side.
  const tailX = tail === 'left' ? x + 18 : x + width - 18
  const tipX = tail === 'left' ? x + 6 : x + width - 6
  context.beginPath()
  context.roundRect(x, y, width, height, 12)
  context.moveTo(tailX - 7, y + height)
  context.lineTo(tipX, y + height + BUBBLE_TAIL_PX)
  context.lineTo(tailX + 7, y + height)
  context.closePath()
  context.fillStyle = palette.panel
  context.globalAlpha = 0.94
  context.fill()
  context.globalAlpha = 1
  context.lineWidth = mood ? 2 : 1
  context.strokeStyle = edge
  context.stroke()
  // The tail's seam with the body is covered, so the outline reads as one shape.
  context.fillStyle = palette.panel
  context.fillRect(tailX - 6, y + height - 1.5, 12, 2.5)

  context.font = FONT
  context.fillStyle = palette.ink
  context.textBaseline = 'middle'
  lines.forEach((line, index) => context.fillText(line, x + BUBBLE_PADDING_PX, y + BUBBLE_PADDING_PX + BUBBLE_LINE_PX * (index + 0.5)))

  const sign = mood && BUBBLE_MOODS[mood].sign
  if (sign)
    drawSign(sign, x + width - BUBBLE_PADDING_PX - 5, y + BUBBLE_PADDING_PX + 7, edge)
  paintedTail = tail
  dirty = false
  const material = sprite.value?.material as SpriteMaterial | undefined
  if (material?.map)
    material.map.needsUpdate = true
}

function clearTimers() {
  clearTimeout(partTimer)
  clearTimeout(hideTimer)
  partTimer = undefined
  hideTimer = undefined
}

function say(text: string) {
  clearTimers()
  const parts = bubbleParts(text)
  const next = (index: number) => {
    show(parts[index])
    if (index + 1 < parts.length)
      partTimer = setTimeout(next, bubblePartMs(parts[index]), index + 1)
  }
  next(0)
}

const projected = new ThreeVector3()
const sideways = new ThreeVector3()

/** The head's box on screen, as the presence bubble measures it. */
function headBox(active: PerspectiveCamera, width: number, height: number) {
  const anchor = props.headAnchor()
  if (!anchor)
    return undefined
  projected.copy(anchor.position).project(active)
  const centreX = (projected.x + 1) / 2 * width
  const centreY = (1 - projected.y) / 2 * height
  const depth = projected.z
  sideways.setFromMatrixColumn(active.matrixWorld, 0).multiplyScalar(anchor.radius).add(anchor.position).project(active)
  const reach = Math.abs((sideways.x + 1) / 2 * width - centreX)
  return { x: centreX - reach, y: centreY - reach, width: reach * 2, height: reach * 2, depth }
}

function scaleForPixels(active: PerspectiveCamera, pixels: number, viewportHeight: number) {
  return pixels / viewportHeight * 2 * Math.tan(active.fov * Math.PI / 360)
}

onBeforeRender(({ delta }) => {
  const current = sprite.value
  const active = activeCamera.value as PerspectiveCamera | undefined
  if (!current || !active)
    return

  const step = preferredMotion.value === 'reduce' ? 1 : Math.min(1, delta * 6)
  opacity += (target - opacity) * step
  if (opacity < 0.02 && target === 0) {
    opacity = 0
    current.visible = false
    return
  }

  const stage = { width: sizes.width.value, height: sizes.height.value }
  const head = headBox(active, stage.width, stage.height)
  if (!head) {
    current.visible = false
    return
  }
  const place = placeBubble(head, size, stage)
  if (dirty || paintedTail !== place.tail)
    paint(place.tail)

  const material = current.material as SpriteMaterial
  material.opacity = opacity
  current.center.set(0, 1)
  current.scale.set(scaleForPixels(active, CANVAS_WIDTH, stage.height), scaleForPixels(active, CANVAS_HEIGHT, stage.height), 1)
  current.position.copy(projected.set(place.x / stage.width * 2 - 1, 1 - place.y / stage.height * 2, head.depth).unproject(active))
  current.visible = true
})

onMounted(() => {
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  const created = new Sprite(new SpriteMaterial({
    map: texture,
    transparent: true,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
  }))
  created.renderOrder = Number.MAX_SAFE_INTEGER
  created.visible = false
  sprite.value = created
  scene.value?.add(created)

  stopListening = onDahliaBubble((event) => {
    if (!isStageTamagotchi() || !dahliaSpeechBubbleEnabled()) {
      target = 0
      return
    }
    if (event.type === 'say') {
      say(event.text)
    }
    else if (event.type === 'mood') {
      mood = event.mood
      dirty = true
    }
    else {
      clearTimeout(hideTimer)
      hideTimer = setTimeout(() => {
        target = 0
        mood = undefined
      }, BUBBLE_LINGER_MS)
    }
  })
})

onUnmounted(() => {
  stopListening?.()
  clearTimers()
  const current = sprite.value
  sprite.value = undefined
  if (!current)
    return
  scene.value?.remove(current)
  const material = current.material as SpriteMaterial
  material.map?.dispose()
  material.dispose()
})
</script>

<template>
  <slot />
</template>
