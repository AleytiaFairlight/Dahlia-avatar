import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { ref } from 'vue'

import DahliaMemoryExplorer from './DahliaMemoryExplorer.vue'

import 'virtual:uno.css'

vi.mock('../../stores/dahlia-auth', () => ({
  useDahliaAuth: () => ({ session: ref('session') }),
  dahliaHeaders: () => ({}),
}))

vi.mock('../../libs/dahlia-memory-map', async importOriginal => ({
  ...await importOriginal<typeof import('../../libs/dahlia-memory-map')>(),
  fetchDahliaMemoryMap: async () => ({
    entities: [{ id: 1, name: 'Mira', kind: 'person', aliases: ['sister'] }, { id: 2, name: 'Lisbon', kind: 'place', aliases: [] }],
    memories: [
      { id: 10, kind: 'fact', text: 'Mira lives in Lisbon.', createdAt: '2026-10-02T10:00:00Z', updatedAt: '2026-10-02T10:00:00Z' },
      { id: 11, kind: 'fact', text: 'Purple is her colour.', createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z' },
    ],
    links: [{ memory: 10, entity: 1 }, { memory: 10, entity: 2 }],
  }),
}))

describe('dahlia memory explorer', () => {
  it('draws the people and things her memories name, and lists her memories by month', async () => {
    const screen = render(DahliaMemoryExplorer)

    await vi.waitFor(() => expect(document.querySelectorAll('[data-testid="dahlia-memory-map"] circle')).toHaveLength(3))
    expect(document.querySelector('[data-testid="dahlia-memory-map"]')?.textContent).toContain('Mira')
    await expect.element(screen.getByText('1 more name no one', { exact: false })).toBeVisible()

    await screen.getByRole('button', { name: 'Timeline' }).click()
    const timeline = screen.getByTestId('dahlia-memory-timeline')
    await expect.element(timeline).toHaveTextContent(/November 2026.*Purple is her colour.*October 2026.*Mira lives in Lisbon/)
  })
})
