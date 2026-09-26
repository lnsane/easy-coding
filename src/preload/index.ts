import { contextBridge, ipcRenderer } from 'electron'
import type {
  AIConfig,
  AIConfigInput,
  Creation,
  CreationInput,
  CreationUpdate,
  Project,
  PrepareProjectResult,
  Role,
  RoleInput,
  RunRecord,
  RunLogEntry,
  OrchestrateResult
} from '../shared/types'

/** 润色执行过程的一条日志（与主进程 PolishLog 对应） */
export interface PolishLogEntry {
  kind: 'info' | 'cmd' | 'out' | 'err' | 'done'
  text: string
  at: number
}

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
  /**
   * 调用 Claude Code 润色文档。
   * @param runId      本次执行标识，用于接收执行过程日志
   * @param cwd        关联项目时传项目根目录，Claude Code 在该目录下执行
   * @param docRelPath 文档相对项目根的路径；给了它就让 Claude Code 自己去读
   *                   （而不是把正文塞进 stdin），润色更贴合项目上下文
   */
  polish: (
    runId: string,
    content: string,
    cwd?: string | null,
    docRelPath?: string | null
  ) => Promise<{ ok: boolean; text: string; error?: string }>
  /** 订阅润色执行过程日志；返回取消订阅函数 */
  onPolishLog: (cb: (runId: string, entry: PolishLogEntry) => void) => () => void

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

  // ---------------- 编排角色 ----------------
  listRoles: () => Promise<Role[]>
  getRole: (id: string) => Promise<Role | null>
  saveRole: (input: RoleInput) => Promise<Role>
  deleteRole: (id: string) => Promise<{ ok: boolean; error?: string }>
  duplicateRole: (id: string) => Promise<Role | null>
  setCreationRole: (creationId: string, roleId: string | null) => Promise<void>

  // ---------------- 执行记录 ----------------
  listRuns: (creationId: string) => Promise<RunRecord[]>
  saveRun: (rec: Omit<RunRecord, 'id'> & { id?: string }) => Promise<RunRecord>
  deleteRun: (id: string) => Promise<void>

  // ---------------- 执行编排 ----------------
  /**
   * 执行编排任务：让 Claude Code 在项目里按需求文档实现代码。
   * ⚠️ 会修改项目文件，调用前必须让用户确认。
   */
  orchestrate: (
    runId: string,
    input: {
      projectPath: string
      docRelPath: string
      version: string
      role: { id: string; name: string; title: string; duty: string; prompt: string }
    }
  ) => Promise<OrchestrateResult>
  /** 中止正在执行的编排任务 */
  abortOrchestrate: (runId: string) => Promise<boolean>
  /** 订阅编排执行日志；返回取消订阅函数 */
  onOrchestrateLog: (cb: (runId: string, entry: RunLogEntry) => void) => () => void
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
  polish: (runId, content, cwd, docRelPath) =>
    ipcRenderer.invoke('polish:run', runId, content, cwd ?? null, docRelPath ?? null),
  onPolishLog: (cb) => {
    const listener = (_e: unknown, runId: string, entry: PolishLogEntry): void => cb(runId, entry)
    ipcRenderer.on('polish:log', listener)
    return () => ipcRenderer.removeListener('polish:log', listener)
  },

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
  readFileAt: (projectPath, rel) => ipcRenderer.invoke('file:read-at', projectPath, rel),

  listRoles: () => ipcRenderer.invoke('role:list'),
  getRole: (id) => ipcRenderer.invoke('role:get', id),
  saveRole: (input) => ipcRenderer.invoke('role:save', input),
  deleteRole: (id) => ipcRenderer.invoke('role:delete', id),
  duplicateRole: (id) => ipcRenderer.invoke('role:duplicate', id),
  setCreationRole: (creationId, roleId) =>
    ipcRenderer.invoke('role:set-for-creation', creationId, roleId),

  listRuns: (creationId) => ipcRenderer.invoke('run:list', creationId),
  saveRun: (rec) => ipcRenderer.invoke('run:save', rec),
  deleteRun: (id) => ipcRenderer.invoke('run:delete', id),

  orchestrate: (runId, input) => ipcRenderer.invoke('orchestrate:run', runId, input),
  abortOrchestrate: (runId) => ipcRenderer.invoke('orchestrate:abort', runId),
  onOrchestrateLog: (cb) => {
    const listener = (_e: unknown, runId: string, entry: RunLogEntry): void => cb(runId, entry)
    ipcRenderer.on('orchestrate:log', listener)
    return () => ipcRenderer.removeListener('orchestrate:log', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
