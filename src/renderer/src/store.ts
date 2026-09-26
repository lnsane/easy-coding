import { create } from 'zustand'
import type { AIConfig, AIConfigInput } from '../../shared/types'

interface ConfigState {
  loaded: boolean
  configs: AIConfig[]
  activeConfig: AIConfig | null
  load: () => Promise<void>
  save: (input: AIConfigInput) => Promise<AIConfig>
  remove: (id: string) => Promise<void>
  activate: (id: string) => Promise<void>
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  loaded: false,
  configs: [],
  activeConfig: null,

  load: async () => {
    const [configs, activeConfig] = await Promise.all([
      window.api.listConfigs(),
      window.api.getActiveConfig()
    ])
    set({ configs, activeConfig, loaded: true })
  },

  save: async (input) => {
    const saved = await window.api.saveConfig(input)
    await get().load()
    return saved
  },

  remove: async (id) => {
    await window.api.deleteConfig(id)
    await get().load()
  },

  activate: async (id) => {
    await window.api.setActiveConfig(id)
    await get().load()
  }
}))
