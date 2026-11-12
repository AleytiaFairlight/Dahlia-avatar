import { describe, expect, it } from 'vitest'

import { DAHLIA_PROACTIVE_DEFAULTS, dahliaProactiveHold, dahliaProactiveNotice, PROACTIVE_QUIET_MS, PROACTIVE_WARMUP_MS, readDahliaProactiveSettings } from './dahlia-proactive'

/** 14:00 local time on a fixed day. */
const afternoon = new Date(2026, 10, 12, 14, 0, 0).getTime()
const settings = DAHLIA_PROACTIVE_DEFAULTS

function moment(patch: Partial<Parameters<typeof dahliaProactiveHold>[1]> = {}) {
  return { now: afternoon, startedAt: afternoon - 3_600_000, asked: [], busy: false, idleSeconds: 5, ...patch }
}

describe('dahlia speaking first', () => {
  it('asks her at a quiet moment while the person is there', () => {
    expect(dahliaProactiveHold(settings, moment())).toBeUndefined()
    expect(dahliaProactiveHold(settings, moment({ idleSeconds: undefined })), 'a phone can\'t tell: counts as there').toBeUndefined()
  })

  it('holds back when off, just started, at night, busy, talking, too soon, away, or enough for today', () => {
    expect(dahliaProactiveHold({ ...settings, enabled: false }, moment())).toBe('off')
    expect(dahliaProactiveHold(settings, moment({ startedAt: afternoon - PROACTIVE_WARMUP_MS + 1 }))).toBe('warming-up')
    expect(dahliaProactiveHold(settings, moment({ now: new Date(2026, 10, 12, 3, 0).getTime(), startedAt: 0 }))).toBe('night')
    expect(dahliaProactiveHold({ ...settings, fromHour: 22, toHour: 6 }, moment({ now: new Date(2026, 10, 12, 3, 0).getTime(), startedAt: 0 })), 'hours over midnight').toBeUndefined()
    expect(dahliaProactiveHold(settings, moment({ busy: true }))).toBe('busy')
    expect(dahliaProactiveHold(settings, moment({ lastTurnAt: afternoon - PROACTIVE_QUIET_MS + 1 }))).toBe('talking')
    expect(dahliaProactiveHold(settings, moment({ lastAskedAt: afternoon - 44 * 60_000 }))).toBe('too-soon')
    expect(dahliaProactiveHold(settings, moment({ lastAskedAt: afternoon - 45 * 60_000 }))).toBeUndefined()
    expect(dahliaProactiveHold(settings, moment({ idleSeconds: 300 }))).toBe('away')
    const today = Array.from({ length: 8 }, (_, i) => afternoon - (i + 1) * 3_600_000)
    expect(dahliaProactiveHold(settings, moment({ asked: today, lastAskedAt: today[0] }))).toBe('enough-today')
    expect(dahliaProactiveHold(settings, moment({ asked: today.map(at => at - 86_400_000) })), 'yesterday\'s don\'t count').toBeUndefined()
  })

  it('reads its settings and tells her how long it has been', () => {
    expect(readDahliaProactiveSettings(null)).toEqual(settings)
    expect(readDahliaProactiveSettings('{"enabled":false,"everyMinutes":3,"toHour":99,"perDay":"x"}')).toEqual({ ...settings, enabled: false, everyMinutes: 10, toHour: 24 })
    expect(readDahliaProactiveSettings('broken')).toEqual(settings)
    expect(dahliaProactiveNotice({ now: afternoon, lastTurnAt: afternoon - 25 * 60_000 }).note).toContain('You last talked 25 minutes ago.')
    expect(dahliaProactiveNotice({ now: afternoon, lastTurnAt: afternoon - 5 * 3_600_000 }).note).toContain('5 hours ago')
    expect(dahliaProactiveNotice({ now: afternoon }).note).toContain('stay quiet')
  })
})
