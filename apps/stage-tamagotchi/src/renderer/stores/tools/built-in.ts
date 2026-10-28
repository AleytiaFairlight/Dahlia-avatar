import type { ExecutableTool } from '@proj-airi/stage-ui/stores/ai/chat-llm/tools'
import type { ChatToolReference } from '@proj-airi/stage-ui/types/chat'

import { useLlmToolsStore } from '@proj-airi/stage-ui/stores/ai/chat-llm/tools'
import { TOOL_ICONS } from '@proj-airi/stage-ui/tools/icons'
import { defineStore } from 'pinia'

import { computerUseTools } from './builtin/computer-use'
import { imageJournalTools } from './builtin/image-journal'
import { weatherTools } from './builtin/weather'
import { widgetsTools } from './builtin/widgets'

export const computerUseToolReferences = [
  { name: 'computer_use' },
  { name: 'computer_use_read_image' },
] satisfies ChatToolReference[]

// Dahlia: none of AIRI's stage built-in tools are offered to her chat. She drives this PC and her apps with
// her own device tools (dahlia-remote-tools.ts: screenshot, tap, game, PowerShell, ...) and her MCP tools,
// and her small model picks AIRI's widgets over them -- she'd reach for image_journal or get_weather to "look
// at the game" instead of screenshot and tap. get_weather can't even reach a weather service from the
// locked-down apps (Dahlia's server only). The arrays stay exported, and empty, so every path that offers
// them (new turns, retries, spotlight) offers nothing from here. scripts/apply_avatar_branding.sh empties
// them again after each AIRI merge.
export const widgetToolReferences = [] satisfies ChatToolReference[]

export const artistryToolReferences = [] satisfies ChatToolReference[]

export const useTamagotchiBuiltinToolsStore = defineStore('tamagotchi-builtin-tools', () => {
  const llmToolsStore = useLlmToolsStore()
  const toolIdPrefix = 'tamagotchi:'

  function registeredToolIds() {
    return llmToolsStore.tools
      .filter(tool => tool.id.startsWith(toolIdPrefix))
      .map(tool => tool.id)
  }

  async function refresh() {
    // Each module declares one icon that the chat shows on every call of its tools.
    const groups = await Promise.all([
      imageJournalTools().then(tools => ({ tools, icon: TOOL_ICONS.imageJournal })),
      widgetsTools().then(tools => ({ tools, icon: TOOL_ICONS.widgets })),
      weatherTools().then(tools => ({ tools, icon: TOOL_ICONS.weather })),
      computerUseTools().then(tools => ({ tools, icon: TOOL_ICONS.computerUse })),
    ])

    llmToolsStore.removeToolsByIds(...registeredToolIds())
    llmToolsStore.addTools(...groups.flatMap(({ tools, icon }) => tools.map(tool => ({
      ...tool,
      icon,
      defaultActive: false,
      requiresExplicitSelection: computerUseToolReferences.some(reference => reference.name === tool.function.name),
      id: `${toolIdPrefix}${tool.function.name}`,
    } satisfies ExecutableTool))))
  }

  return { refresh }
}, {
  synced: {
    actions: ['refresh'],
    state: false,
  },
})
