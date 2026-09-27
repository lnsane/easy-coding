import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import {
  initDb,
  listConfigs,
  getActiveConfig,
  saveConfig,
  deleteConfig,
  setActiveConfig,
  listCreations,
  getCreation,
  createCreation,
  updateCreation,
  deleteCreation,
  listCreationVersions,
  setCreationFile,
  listProjects,
  getProject,
  upsertProject,
  deleteProject,
  listRoles,
  getRole,
  saveRole,
  deleteRole,
  duplicateRole,
  listRuns,
  saveRun,
  deleteRun,
  setCreationRole
} from './db'
import type { AIConfigInput, CreationInput, CreationUpdate } from '../shared/types'
import { polishDocument } from './polish'
import { checkClaudeAvailable } from './claude-bin'
import { prepareProject, pickDirectory, projectBranchOf } from './projects'
import { orchestrate } from './orchestrate'
import { generatePlan } from './plan'
import { writeDocFile, writeFileAt, readFileAt, validateProjectDir } from './files'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'easyCode',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('ai-config:list', () => listConfigs())
  ipcMain.handle('ai-config:get-active', () => getActiveConfig())
  ipcMain.handle('ai-config:save', (_e, input: AIConfigInput) => saveConfig(input))
  ipcMain.handle('ai-config:delete', (_e, id: string) => deleteConfig(id))
  ipcMain.handle('ai-config:set-active', (_e, id: string) => setActiveConfig(id))

  ipcMain.handle('creation:list', () => listCreations())
  ipcMain.handle('creation:get', (_e, id: string) => getCreation(id))
  ipcMain.handle('creation:create', (_e, input: CreationInput) => createCreation(input))
  ipcMain.handle('creation:update', (_e, id: string, patch: CreationUpdate) =>
    updateCreation(id, patch)
  )
  ipcMain.handle('creation:delete', (_e, id: string) => deleteCreation(id))
  ipcMain.handle('creation:versions', () => listCreationVersions())

  ipcMain.handle('polish:available', () => checkClaudeAvailable())
  ipcMain.handle(
    'polish:run',
    (
      e,
      runId: string,
      content: string,
      cwd?: string | null,
      docRelPath?: string | null
    ) => {
      // 执行过程通过同一 runId 实时推给渲染层，界面才能显示「到底在干什么」
      return polishDocument(content, cwd, (entry) => {
        if (!e.sender.isDestroyed()) {
          e.sender.send('polish:log', runId, entry)
        }
      }, docRelPath)
    }
  )

  // ---------------- 项目与 git ----------------
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:get', (_e, id: string) => getProject(id))
  ipcMain.handle('project:pick-dir', () => pickDirectory())
  ipcMain.handle('project:prepare', (_e, input: Parameters<typeof prepareProject>[0]) =>
    prepareProject(input)
  )
  ipcMain.handle('project:branch', (_e, id: string) => projectBranchOf(id))
  ipcMain.handle('project:delete', (_e, id: string) => deleteProject(id))
  ipcMain.handle('project:validate', (_e, dir: string) => validateProjectDir(dir))
  ipcMain.handle(
    'project:add-local',
    (_e, input: { name: string; path: string; gitUrl?: string | null }) =>
      upsertProject({ ...input, source: 'local' })
  )

  // ---------------- 文档文件 ----------------
  ipcMain.handle('file:write-doc', (_e, projectPath: string, title: string, content: string) =>
    writeDocFile(projectPath, title, content)
  )
  ipcMain.handle('file:write-at', (_e, projectPath: string, rel: string, content: string) =>
    writeFileAt(projectPath, rel, content)
  )
  ipcMain.handle('file:read-at', (_e, projectPath: string, rel: string) =>
    readFileAt(projectPath, rel)
  )
  ipcMain.handle('creation:set-file', (_e, id: string, filePath: string, branch: string | null) =>
    setCreationFile(id, filePath, branch)
  )

  // ---------------- 编排角色 ----------------
  ipcMain.handle('role:list', () => listRoles())
  ipcMain.handle('role:get', (_e, id: string) => getRole(id))
  ipcMain.handle('role:save', (_e, input: Parameters<typeof saveRole>[0]) => saveRole(input))
  ipcMain.handle('role:delete', (_e, id: string) => deleteRole(id))
  ipcMain.handle('role:duplicate', (_e, id: string) => duplicateRole(id))
  ipcMain.handle('role:set-for-creation', (_e, creationId: string, roleId: string | null) =>
    setCreationRole(creationId, roleId)
  )

  // ---------------- 执行记录 ----------------
  ipcMain.handle('run:list', (_e, creationId: string) => listRuns(creationId))
  ipcMain.handle('run:save', (_e, rec: Parameters<typeof saveRun>[0]) => saveRun(rec))
  ipcMain.handle('run:delete', (_e, id: string) => deleteRun(id))

  // ---------------- 执行编排 ----------------
  // 正在运行的任务：runId → 中止信号，供「中止」按钮置位
  ipcMain.handle(
    'orchestrate:run',
    (
      e,
      runId: string,
      input: Omit<Parameters<typeof orchestrate>[0], 'onLog' | 'signal'>
    ) => {
      const signal = { aborted: false }
      activeRuns.set(runId, signal)
      return orchestrate({
        ...input,
        signal,
        onLog: (entry) => {
          if (!e.sender.isDestroyed()) e.sender.send('orchestrate:log', runId, entry)
        }
      }).finally(() => {
        activeRuns.delete(runId)
      })
    }
  )
  ipcMain.handle('orchestrate:abort', (_e, runId: string) => {
    const s = activeRuns.get(runId)
    if (s) {
      s.aborted = true
      return true
    }
    return false
  })

  // ---------------- 生成开发计划 ----------------
  ipcMain.handle(
    'plan:generate',
    (e, runId: string, content: string, title: string, cwd?: string | null) => {
      return generatePlan(content, title, cwd, (entry) => {
        if (!e.sender.isDestroyed()) e.sender.send('plan:log', runId, entry)
      })
    }
  )
}

/** 正在执行的编排任务：runId → 中止信号 */
const activeRuns = new Map<string, { aborted: boolean }>()

app.whenReady().then(() => {
  initDb()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
