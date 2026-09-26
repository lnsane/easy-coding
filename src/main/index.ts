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
  deleteProject
} from './db'
import type { AIConfigInput, CreationInput, CreationUpdate } from '../shared/types'
import { checkClaudeAvailable, polishDocument } from './polish'
import { prepareProject, pickDirectory, projectBranchOf } from './projects'
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
}

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
