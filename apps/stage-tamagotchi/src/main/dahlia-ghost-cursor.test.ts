import { describe, expect, it, vi } from 'vitest'

import { ghostCursorPage } from './dahlia-ghost-cursor'

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), ipcMain: { handle: vi.fn() }, screen: {} }))

describe('dahlia ghost cursor', () => {
  it('shows her words as text, never as markup', () => {
    const page = ghostCursorPage('<img src=x onerror=alert(1)> "click"')

    expect(page).toContain('&lt;img src=x onerror=alert(1)&gt; &quot;click&quot;')
    expect(page).not.toContain('<img')
    expect(ghostCursorPage('')).not.toContain('class="label"')
  })
})
