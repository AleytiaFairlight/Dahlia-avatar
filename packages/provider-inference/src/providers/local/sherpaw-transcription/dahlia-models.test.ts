// Dahlia: tests for dahlia-models.ts, the English speech model of the Dahlia apps.
import { describe, expect, it } from 'vitest'

import { dahliaTranscriptText, zipformerEnglishInt8 } from './dahlia-models'
import { paraformerBilingualZhEn, selectSherpawModel, sherpawModels, xAsrBilingualZhEnInt8 } from './models'

describe('dahlia english speech model', () => {
  it('is in the catalogue and chosen wherever an app offers it', () => {
    expect(sherpawModels[zipformerEnglishInt8.id]).toBe(zipformerEnglishInt8)

    const offered = [zipformerEnglishInt8]
    expect(selectSherpawModel(offered, 'en', { isMobile: true })).toBe(zipformerEnglishInt8)
    expect(selectSherpawModel(offered, 'en', { isMobile: false })).toBe(zipformerEnglishInt8)
    // An interface in another language still gets the English model.
    expect(selectSherpawModel(offered, 'de', { isMobile: true })).toBe(zipformerEnglishInt8)
    expect(selectSherpawModel([paraformerBilingualZhEn, xAsrBilingualZhEnInt8, zipformerEnglishInt8], 'en', { isMobile: true })).toBe(zipformerEnglishInt8)
  })

  it.each([
    ['WHAT TIME IS IT', 'What time is it'],
    ['HEY DAHLIA I\'M LOOKING FOR MY INVOICE', 'Hey Dahlia I\'m looking for my invoice'],
    ['CAN I ASK YOU SOMETHING', 'Can I ask you something'],
    ['', ''],
  ])('writes %j in sentence case', (heard, written) => {
    expect(dahliaTranscriptText(zipformerEnglishInt8, heard)).toBe(written)
  })

  it('leaves the text of other models as it is', () => {
    expect(dahliaTranscriptText(paraformerBilingualZhEn, 'WHAT TIME')).toBe('WHAT TIME')
    expect(dahliaTranscriptText(zipformerEnglishInt8, 'Already cased')).toBe('Already cased')
  })
})
