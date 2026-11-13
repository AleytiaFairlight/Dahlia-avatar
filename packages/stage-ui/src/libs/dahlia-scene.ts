// Dahlia: what a picture shows. While she watches a screen, a small vision model on the PC (Mirage, 22 MB, run by
// the desktop app in a background worker) says what each changed capture shows and where the things in it are.
// That description goes to her server's decision model together with the text Windows reads: the text says what
// is written, the scene what kind of thing it is, and for a game or a video the scene is all there is. Where
// neither text nor change points anywhere, the thing the model is surest of is where she looks closely. The
// model can't read small text, which is why Windows' OCR stays beside it. The idea and the model are from the attention lab of
// dasilva333/airi (docs/design-cactus-mirage-local-vision.md); the code is Dahlia's. This file is Dahlia's.

export interface DahliaSceneObject {
  name: string
  /** Its box in thousandths of the picture: x1, y1, x2, y2. */
  box: { x1: number, y1: number, x2: number, y2: number }
  score: number
}

export interface DahliaScene {
  /** What the picture shows, in a sentence or two. */
  description: string
  objects: DahliaSceneObject[]
}

/** The files of the scene model with their SHA-256, as Dahlia's server hands them out. */
export const DAHLIA_SCENE_FILES: Array<{ name: string, sha256: string }> = [
  { name: 'cactus.js', sha256: 'bb61bcf0c48712bfb9cd0ade8f0748889dfde9944ac308220f42afbc605f82bc' },
  { name: 'cactus.wasm', sha256: '4198b30795ded7739fe6c9e80bf26d5a844767c081574d40c8dc0487cde8b4b6' },
  { name: 'mirage.cact', sha256: '4249a0f7515272ff76b9414bec17d7e7daf84b15b66c7fb4f17fce1e66f9f237' },
]
/** The picture the model gets is at most this many pixels on its longer side: larger is slower, not better. */
export const DAHLIA_SCENE_SIDE = 384
/** At most one description in this long. */
export const DAHLIA_SCENE_GAP_MS = 5000
/** Things the model is less sure of than this are left out. */
const MIN_SCORE = 0.3

function clamp(value: unknown) {
  return Math.min(1000, Math.max(0, Math.round(Number(value) || 0)))
}

interface RawObject { name?: unknown, bbox?: unknown, score?: unknown }
interface RawScene { reasoning?: unknown, scene?: { setting?: unknown, style?: unknown } | null, objects?: unknown }

/** The model's JSON as a scene; undefined when it says nothing usable. */
export function parseDahliaScene(json: string): DahliaScene | undefined {
  let parsed: RawScene | null
  try {
    parsed = JSON.parse(json) as RawScene | null
  }
  catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object')
    return undefined

  // "lang: en | what it shows | general remarks | what it can't tell": the second and third part are the description.
  const parts = typeof parsed.reasoning === 'string' ? parsed.reasoning.split('|').map(part => part.trim()).filter(Boolean) : []
  const said = parts.filter(part => !/^lang:/i.test(part) && !/\b(?:cannot|can't|unknown|unreadable)\b/i.test(part)).slice(0, 2).join('; ')
  const scene = [parsed.scene?.setting, parsed.scene?.style].filter((value): value is string => typeof value === 'string' && value.length > 0).join(', ')
  const objects = (Array.isArray(parsed.objects) ? parsed.objects as RawObject[] : [])
    .filter(object => typeof object?.name === 'string' && Array.isArray(object.bbox) && object.bbox.length === 4 && (Number(object.score) || 0) >= MIN_SCORE)
    .map((object): DahliaSceneObject => {
      const [x1, y1, x2, y2] = object.bbox as unknown[]
      return { name: String(object.name).slice(0, 60), box: { x1: clamp(x1), y1: clamp(y1), x2: clamp(x2), y2: clamp(y2) }, score: Number(object.score) }
    })
    .filter(object => object.box.x2 > object.box.x1 && object.box.y2 > object.box.y1)
    .slice(0, 12)

  const description = [said, scene && `(${scene})`].filter(Boolean).join(' ').slice(0, 400)
  return description || objects.length > 0 ? { description, objects } : undefined
}

/** The scene as a few lines of text, for her server's decision model and for her own model's note. */
export function describeDahliaScene(scene: DahliaScene) {
  const names = [...new Set(scene.objects.map(object => object.name))].slice(0, 8)
  return [scene.description && `Scene: ${scene.description}`, names.length > 0 && `Things in it: ${names.join(', ')}`].filter(Boolean).join('\n')
}

/** The thing to look at closely: the surest one that is neither tiny nor most of the picture. */
export function sceneFocus(scene: DahliaScene) {
  return scene.objects
    .map(object => ({ object, share: ((object.box.x2 - object.box.x1) * (object.box.y2 - object.box.y1)) / 1_000_000 }))
    .filter(({ share }) => share >= 0.01 && share <= 0.45)
    .sort((a, b) => b.object.score - a.object.score)[0]
    ?.object
}

/** Packed RGB bytes from RGBA pixels, as the model takes them. */
export function rgbFromRgba(rgba: Uint8ClampedArray | Uint8Array) {
  const rgb = new Uint8Array((rgba.length / 4) * 3)
  for (let from = 0, to = 0; from < rgba.length; from += 4) {
    rgb[to++] = rgba[from]
    rgb[to++] = rgba[from + 1]
    rgb[to++] = rgba[from + 2]
  }
  return rgb
}
