import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import { initDb, listConfigs, getActiveConfig, saveConfig, deleteConfig, setActiveConfig } from './db'
import type { AIConfigInput } from '../shared/types'

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
