import type { EasyCodeApi } from '../preload/index'

declare global {
  interface Window {
    api: EasyCodeApi
  }
}

export {}
