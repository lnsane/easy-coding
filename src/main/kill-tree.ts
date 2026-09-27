import { execSync } from 'node:child_process'

/**
 * 杀掉一个子进程及其派生的整棵进程树。
 *
 * ⚠️ 不要用 `child.kill()`：它只杀直接子进程，`claude.exe` 会变成孤儿继续跑
 * （实测残留，继续消耗 token）。这个坑在编排功能里踩过一次，但当时把实现
 * 留在了 orchestrate.ts 内部，导致 polish.ts 与 plan.ts 又各犯一次。
 * 因此抽到这里，三处共用。
 *
 * Windows 用 `taskkill /T`（杀整棵树）；POSIX 下用负 PID 杀进程组
 * ——这要求 spawn 时带 `detached: true` 才会自成进程组。
 */
export function killTree(pid: number | undefined, detached = false): void {
  if (!pid) return

  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' })
    } catch {
      // 进程可能已退出，忽略
    }
    return
  }

  if (detached) {
    try {
      // 负号 = 进程组
      process.kill(-pid, 'SIGKILL')
      return
    } catch {
      // 落到单进程兜底
    }
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // 忽略
  }
}
