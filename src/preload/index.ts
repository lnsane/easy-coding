import { contextBridge, ipcRenderer } from 'electron'
import type {
  AIConfig,
  AIConfigInput,
  Creation,
  CreationInput,
  CreationUpdate,
  Project,
  PrepareProjectResult
} from '../shared/types'

export interface EasyCodeApi {
  listConfigs: () => Promise<AIConfig[]>
  getActiveConfig: () => Promise<AIConfig | null>
  saveConfig: (input: AIConfigInput) => Promise<AIConfig>
  deleteConfig: (id: string) => Promise<void>
  setActiveConfig: (id: string) => Promise<void>

  listCreations: () => Promise<Creation[]>
  getCreation: (id: string) => Promise<Creation | null>
  createCreation: (input: CreationInput) => Promise<Creation>
  updateCreation: (id: string, patch: CreationUpdate) => Promise<Creation>
  deleteCreation: (id: string) => Promise<void>
  listCreationVersions: () => Promise<string[]>
  setCreationFile: (id: string, filePath: string, branch: string | null) => Promise<void>

  /** 本机 Claude Code CLI 是否可用 */
  polishAvailable: () => Promise<{ available: boolean; path?: string }>
  /** 调用 Claude Code 润色文档；传 cwd 则在该目录下执行（关联项目时用） */
  polish: (content: string, cwd?: string | null) => Promise<{ ok: boolean; text: string; error?: string }>

  // ---------------- 项目与 git ----------------
  listProjects: () => Promise<Project[]>
  getProject: (id: string) => Promise<Project | null>
  pickProjectDir: () => Promise<string | null>
  prepareProject: (input: {
    projectId?: string | null
    gitUrl?: string | null
    localPath?: string | null
    version: string
  }) => Promise<PrepareProjectResult>
  projectBranch: (id: string) => Promise<string | null>
  deleteProject: (id: string) => Promise<void>
  validateProjectDir: (dir: string) => Promise<{ ok: boolean; error?: string }>
  addLocalProject: (input: {
    name: string
    path: string
    gitUrl?: string | null
  }) => Promise<Project>

  // ---------------- 文档文件 ----------------
  writeDocFile: (projectPath: string, title: string, content: string) => Promise<string>
  writeFileAt: (projectPath: string, rel: string, content: string) => Promise<void>
  readFileAt: (projectPath: string, rel: string) => Promise<string | null>
}

const api: EasyCodeApi = {
  listConfigs: () => ipcRenderer.invoke('ai-config:list'),
  getActiveConfig: () => ipcRenderer.invoke('ai-config:get-active'),
  saveConfig: (input) => ipcRenderer.invoke('ai-config:save', input),
  deleteConfig: (id) => ipcRenderer.invoke('ai-config:delete', id),
  setActiveConfig: (id) => ipcRenderer.invoke('ai-config:set-active', id),

  listCreations: () => ipcRenderer.invoke('creation:list'),
  getCreation: (id) => ipcRenderer.invoke('creation:get', id),
  createCreation: (input) => ipcRenderer.invoke('creation:create', input),
  updateCreation: (id, patch) => ipcRenderer.invoke('creation:update', id, patch),
  deleteCreation: (id) => ipcRenderer.invoke('creation:delete', id),
  listCreationVersions: () => ipcRenderer.invoke('creation:versions'),
  setCreationFile: (id, filePath, branch) =>
    ipcRenderer.invoke('creation:set-file', id, filePath, branch),

  polishAvailable: () => ipcRenderer.invoke('polish:available'),
  polish: (content, cwd) => ipcRenderer.invoke('polish:run', content, cwd ?? null),

  listProjects: () => ipcRenderer.invoke('project:list'),
  getProject: (id) => ipcRenderer.invoke('project:get', id),
  pickProjectDir: () => ipcRenderer.invoke('project:pick-dir'),
  prepareProject: (input) => ipcRenderer.invoke('project:prepare', input),
  projectBranch: (id) => ipcRenderer.invoke('project:branch', id),
  deleteProject: (id) => ipcRenderer.invoke('project:delete', id),
  validateProjectDir: (dir) => ipcRenderer.invoke('project:validate', dir),
  addLocalProject: (input) => ipcRenderer.invoke('project:add-local', input),

  writeDocFile: (projectPath, title, content) =>
    ipcRenderer.invoke('file:write-doc', projectPath, title, content),
  writeFileAt: (projectPath, rel, content) =>
    ipcRenderer.invoke('file:write-at', projectPath, rel, content),
  readFileAt: (projectPath, rel) => ipcRenderer.invoke('file:read-at', projectPath, rel)
}

contextBridge.exposeInMainWorld('api', api)
