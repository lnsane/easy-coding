import { spawn } from 'node:child_process'

/**
 * git 操作封装。
 *
 * 三个必须处理的坑：
 *
 * 1. **私有仓库会让 git 永久挂起**——没有终端时它会一直等凭据输入。
 *    所有调用都带 `GIT_TERMINAL_PROMPT=0` 与 `GCM_INTERACTIVE=never`，
 *    让它在缺凭据时直接失败，而不是卡死界面。
 * 2. **空仓库（无 commit）下 checkout -b 会失败**——因为没有 HEAD。
 *    需要单独检测并给出明确提示。
 * 3. **不经 shell**——路径可能含空格或特殊字符，用参数数组传递。
 */

export interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
  code: number | null
}

const DEFAULT_TIMEOUT = 120_000

/** 统一的环境：禁掉一切交互式提示，避免无终端时挂起 */
function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    // 避免在用户主目录之外意外读取到别的仓库配置
    GIT_OPTIONAL_LOCKS: '0'
  }
}

export function runGit(args: string[], cwd?: string, timeout = DEFAULT_TIMEOUT): Promise<GitResult> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('git', args, {
        cwd,
        shell: false,
        windowsHide: true,
        env: gitEnv(),
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      resolve({ ok: false, stdout: '', stderr: String(err), code: null })
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (r: GitResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }

    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // 忽略
      }
      finish({ ok: false, stdout, stderr: 'git 命令超时', code: null })
    }, timeout)

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString('utf8')
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
    })
    child.on('error', (err) => finish({ ok: false, stdout, stderr: err.message, code: null }))
    child.on('close', (code) =>
      finish({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), code })
    )
  })
}

/** 从 git 地址推导仓库名，用于本地目录名 */
export function repoNameFromUrl(url: string): string {
  const cleaned = url.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  // 支持 https://host/a/b.git、git@host:a/b.git、ssh://host/a/b
  const tail = cleaned.split(/[/:]/).filter(Boolean).pop() ?? 'repo'
  return tail.replace(/[^A-Za-z0-9._-]/g, '-') || 'repo'
}

export async function isGitRepo(path: string): Promise<boolean> {
  const r = await runGit(['rev-parse', '--is-inside-work-tree'], path, 20_000)
  return r.ok && r.stdout.trim() === 'true'
}

/** 仓库是否有提交（空仓库没有 HEAD，checkout -b 会失败） */
export async function hasCommits(path: string): Promise<boolean> {
  const r = await runGit(['rev-parse', '--verify', 'HEAD'], path, 20_000)
  return r.ok
}

export async function currentBranch(path: string): Promise<string | null> {
  const r = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], path, 20_000)
  if (!r.ok) return null
  return r.stdout.trim() || null
}

/** 本地分支名列表 */
export async function listBranches(path: string): Promise<string[]> {
  const r = await runGit(['branch', '--format=%(refname:short)'], path, 20_000)
  if (!r.ok) return []
  return r.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 工作区是否干净（无未提交改动、无未跟踪文件） */
export async function isClean(path: string): Promise<boolean> {
  const r = await runGit(['status', '--porcelain'], path, 30_000)
  return r.ok && r.stdout.trim() === ''
}

export async function cloneRepo(url: string, dest: string): Promise<GitResult> {
  return runGit(['clone', url, dest], undefined, 10 * 60_000)
}

export interface EnsureBranchResult {
  ok: boolean
  /** 实际所在分支 */
  branch?: string
  /** 本次是新建分支还是切换过去的 */
  action?: 'created' | 'switched' | 'already'
  error?: string
}

/**
 * 确保位于指定分支：已存在则切换过去，不存在则新建。
 *
 * 遵守「工作区不干净就拒绝」的约定——切换分支会影响用户的未提交改动，
 * 绝不自动 stash 或覆盖。
 */
export async function ensureBranch(projectPath: string, branch: string): Promise<EnsureBranchResult> {
  if (!(await isGitRepo(projectPath))) {
    return { ok: false, error: `不是 git 仓库：${projectPath}` }
  }

  const branches = await listBranches(projectPath)
  const exists = branches.includes(branch)

  // 已经在目标分支上，无需任何操作
  const current = await currentBranch(projectPath)
  if (current === branch) {
    return { ok: true, branch, action: 'already' }
  }

  // 需要切换或新建：先确认工作区干净，避免动到用户的未提交改动
  if (!(await isClean(projectPath))) {
    return {
      ok: false,
      error:
        '项目有未提交的改动，为避免影响你的工作已中止切换分支。\n' +
        '请先提交或 stash 后重试。'
    }
  }

  if (exists) {
    const r = await runGit(['checkout', branch], projectPath)
    if (!r.ok) {
      return { ok: false, error: `切换分支失败：${r.stderr || `退出码 ${r.code}`}` }
    }
    return { ok: true, branch, action: 'switched' }
  }

  // 空仓库没有 HEAD，无法直接 checkout -b
  if (!(await hasCommits(projectPath))) {
    return {
      ok: false,
      error:
        '仓库还没有任何提交，无法创建分支。\n' +
        '请先在该项目中完成一次提交（git add . && git commit -m "init"）后重试。'
    }
  }

  const r = await runGit(['checkout', '-b', branch], projectPath)
  if (!r.ok) {
    return { ok: false, error: `创建分支失败：${r.stderr || `退出码 ${r.code}`}` }
  }
  return { ok: true, branch, action: 'created' }
}

/** 版本号 → 分支名：1.0 → v1.0 */
export function branchNameForVersion(version: string): string {
  const v = version.trim()
  return v.startsWith('v') ? v : `v${v}`
}
