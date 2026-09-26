import { contextBridge, ipcRenderer } from 'electron'
import type { AIConfig, AIConfigInput } from '../shared/types'

export interface EasyCodeApi {
  listConfigs: () => Promise<AIConfig[]>
  getActiveConfig: () => Promise<AIConfig | null>
  saveConfig: (input: AIConfigInput) => Promise<AIConfig>
  deleteConfig: (id: string) => Promise<void>
  setActiveConfig: (id: string) => Promise<void>
}

const api: EasyCodeApi = {
  listConfigs: () => ipcRenderer.invoke('ai-config:list'),
  getActiveConfig: () => ipcRenderer.invoke('ai-config:get-active'),
  saveConfig: (input) => ipcRenderer.invoke('ai-config:save', input),
  deleteConfig: (id) => ipcRenderer.invoke('ai-config:delete', id),
  setActiveConfig: (id) => ipcRenderer.invoke('ai-config:set-active', id)
}

contextBridge.exposeInMainWorld('api', api)
