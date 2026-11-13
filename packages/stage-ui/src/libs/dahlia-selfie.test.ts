import { describe, expect, it } from 'vitest'

import { registerDahliaSelfie, selfieSize, takeDahliaSelfie } from './dahlia-selfie'

describe('dahlia selfie', () => {
  it('scales a large picture down and leaves a small one', () => {
    expect(selfieSize(2560, 1440)).toEqual({ width: 1280, height: 720 })
    expect(selfieSize(900, 1600)).toEqual({ width: 720, height: 1280 })
    expect(selfieSize(640, 480)).toEqual({ width: 640, height: 480 })
  })

  it('says what is missing without a stage or without a picture', async () => {
    await expect(takeDahliaSelfie()).rejects.toThrow('isn\'t on screen')
    const remove = registerDahliaSelfie(async () => null)
    await expect(takeDahliaSelfie()).rejects.toThrow('no picture')
    remove()
    await expect(takeDahliaSelfie()).rejects.toThrow('isn\'t on screen')
  })
})
