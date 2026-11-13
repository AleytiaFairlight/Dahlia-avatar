// Dahlia: selfies. She can take a picture of herself as she is on the stage right now, avatar and background, see
// it, and keep it in the person's Pictures folder (her avatar_selfie tool on the PC). The stage hands this file
// the way to photograph itself (scripts/apply_avatar_branding.sh adds the call to Stage.vue). The idea is the
// photo mode and selfies of dasilva333/airi; the code is Dahlia's. This file is Dahlia's (AIRI has no such file).

type Capture = () => Promise<Blob | null | undefined> | undefined

let capture: Capture | undefined

/** The stage registers how to photograph itself; answers the function that takes it back. */
export function registerDahliaSelfie(source: Capture) {
  capture = source
  return () => {
    if (capture === source)
      capture = undefined
  }
}

/** A selfie is at most this many pixels on its longer side. */
export const DAHLIA_SELFIE_SIDE = 1280

/** The size a picture is scaled to, keeping its shape. */
export function selfieSize(width: number, height: number, side = DAHLIA_SELFIE_SIDE) {
  const scale = Math.min(1, side / Math.max(width, height, 1))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * A picture of the stage as a PNG: its bytes for the file, and a data URL for her to look at. Throws with what is
 * missing when there is no stage in this window or it gave no picture.
 */
export async function takeDahliaSelfie(): Promise<{ png: Uint8Array, dataUrl: string, width: number, height: number }> {
  if (!capture)
    throw new Error('Her avatar isn\'t on screen in this window.')
  const blob = await capture()
  if (!blob || blob.size === 0)
    throw new Error('The stage gave no picture; is a model loaded?')
  const bitmap = await createImageBitmap(blob)
  const { width, height } = selfieSize(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!png)
    throw new Error('The picture couldn\'t be saved as PNG.')
  return { png: new Uint8Array(await png.arrayBuffer()), dataUrl: canvas.toDataURL('image/jpeg', 0.9), width, height }
}
