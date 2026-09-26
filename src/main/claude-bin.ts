import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { app } from 'electron'

/**
 * 定位本机 Claude Code CLI 的可执行文件。
 *
 * 单独成模块的原因：polish.ts 与 orchestrate.ts 都要用，且这里踩过坑——
 * `spawn('claude', ...)` 在**未经 shell**的情况下，Windows 上找不到
 * WinGet 安装的 claude.exe（它不在 PATH 的可执行扩展名解析范围内），
 * 必须解析出完整路径再 spawn。
 */

/** 常见安装位置，用于 where/which 失败时兜底 */
function candidatePaths(): string[] {
  const home = app.getPath('home')
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude']
  const dirs = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    path.join(home, 'AppData', 'Roaming', 'npm'),
    '/usr/local/bin',
    '/usr/bin',
    '/opt/homebrew/bin'
  ]
  return dirs.flatMap((d) => names.map((n) => path.join(d, n)))
}

let cached: string | null | undefined

/**
 * 解析可执行文件路径；解析结果会被缓存。
 * Windows 上 `claude` 可能是 .exe（WinGet）也可能是 .cmd（npm 全局），
 * 用 where/which 拿到 shell 视角下真正会执行的那个。
 */
export function resolveClaudeBinary(): string | null {
  if (cached !== undefined) return cached

  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const out = execFileSync(cmd, ['claude'], { encoding: 'utf8', timeout: 10000 })
    const first = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)[0]
    if (first && fs.existsSync(first)) {
      cached = first
      return cached
    }
  } catch {
    // 忽略，走下面的兜底
  }

  // 兜底：WinGet 的 Packages 目录下带哈希后缀，需要扫一层
  if (process.platform === 'win32') {
    try {
      const base = path.join(app.getPath('home'), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages')
      for (const entry of fs.readdirSync(base)) {
        if (!entry.toLowerCase().includes('claude')) continue
        const exe = path.join(base, entry, 'claude.exe')
        if (fs.existsSync(exe)) {
          cached = exe
          return cached
        }
      }
    } catch {
      // 忽略
    }
  }

  for (const p of candidatePaths()) {
    if (fs.existsSync(p)) {
      cached = p
      return cached
    }
  }

  cached = null
  return null
}

/** 检查本机 claude CLI 是否可用（供界面提示用） */
export function checkClaudeAvailable(): { available: boolean; path?: string } {
  const bin = resolveClaudeBinary()
  return bin ? { available: true, path: bin } : { available: false }
}
