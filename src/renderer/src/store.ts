import { create } from 'zustand'
import type {
  AIConfig,
  AIConfigInput,
  Creation,
  CreationInput,
  CreationUpdate,
  Project,
  PrepareProjectResult
} from '../../shared/types'

interface ConfigState {
  loaded: boolean
  configs: AIConfig[]
  activeConfig: AIConfig | null
  load: () => Promise<void>
  save: (input: AIConfigInput) => Promise<AIConfig>
  remove: (id: string) => Promise<void>
  activate: (id: string) => Promise<void>

  creations: Creation[]
  versions: string[]
  loadCreations: () => Promise<void>
  createCreation: (input: CreationInput) => Promise<Creation>
  updateCreation: (id: string, patch: CreationUpdate) => Promise<void>
  deleteCreation: (id: string) => Promise<void>

  projects: Project[]
  loadProjects: () => Promise<void>
  prepareProject: (input: {
    projectId?: string | null
    gitUrl?: string | null
    localPath?: string | null
    version: string
  }) => Promise<PrepareProjectResult>
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
  },

  // ------------------------- 创作 -------------------------

  creations: [],
  versions: [],

  loadCreations: async () => {
    const [creations, versions] = await Promise.all([
      window.api.listCreations(),
      window.api.listCreationVersions()
    ])
    set({ creations, versions })
  },

  createCreation: async (input) => {
    const created = await window.api.createCreation(input)
    await get().loadCreations()
    return created
  },

  updateCreation: async (id, patch) => {
    await window.api.updateCreation(id, patch)
    // 只刷新列表数据（标题/摘要/时间），不重载正在编辑的文档内容，
    // 否则每次自动保存都会把用户正在输入的编辑器内容顶掉。
    const creations = await window.api.listCreations()
    set({ creations })
  },

  deleteCreation: async (id) => {
    await window.api.deleteCreation(id)
    await get().loadCreations()
  },

  // ------------------------- 项目 -------------------------

  projects: [],

  loadProjects: async () => {
    const projects = await window.api.listProjects()
    set({ projects })
  },

  prepareProject: async (input) => {
    const r = await window.api.prepareProject(input)
    await get().loadProjects()
    return r
  }
}))
