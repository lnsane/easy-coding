import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { dialog } from 'electron'
import type { PrepareProjectResult, Project } from '../shared/types'
import { cloneRepo, ensureBranch, branchNameForVersion, isGitRepo, repoNameFromUrl, currentBranch } from './git'
import { upsertProject, touchProject, getProject } from './db'
import { validateProjectDir } from './files'

/** git 地址 clone 下来的存放根目录：~/.easyCode/projects */
function projectsRoot(): string {
  const dir = path.join(os.homedir(), '.easyCode', 'projects')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export interface PrepareInput {
  /** 复用已登记的项目 */
  projectId?: string | null
  /** 新建：git 地址 */
  gitUrl?: string | null
  /** 新建：本地目录 */
  localPath?: string | null
  /** 用于推导分支名的创作版本号 */
  version: string
}

/**
 * 准备项目：解析来源 → clone 或校验路径 → 确保 git 分支。
 *
 * 返回面向用户的中文说明，界面直接展示，便于定位卡在哪一步。
 */
export async function prepareProject(input: PrepareInput): Promise<PrepareProjectResult> {
  let project: Project | null = null

  // ---------- 1. 解析项目来源 ----------
  if (input.projectId) {
    project = getProject(input.projectId)
    if (!project) return { ok: false, message: '选择的项目不存在，请重新选择。' }
    const v = validateProjectDir(project.path)
    if (!v.ok) return { ok: false, message: v.error ?? '项目目录不可用。' }
  } else if (input.localPath?.trim()) {
    const dir = path.resolve(input.localPath.trim())
    const v = validateProjectDir(dir)
    if (!v.ok) return { ok: false, message: v.error ?? '本地目录不可用。' }
    if (!(await isGitRepo(dir))) {
      return {
        ok: false,
        message: `该目录不是 git 仓库：${dir}\n请选择 git 仓库目录，或先用 git init 初始化。`
      }
    }
    project = upsertProject({ name: path.basename(dir), path: dir, source: 'local' })
  } else if (input.gitUrl?.trim()) {
    const url = input.gitUrl.trim()
    const name = repoNameFromUrl(url)
    const dest = path.join(projectsRoot(), name)

    // 目标目录已存在且是仓库 → 复用（用户可能已 clone 过）
    if (fs.existsSync(dest) && (await isGitRepo(dest))) {
      project = upsertProject({ name, path: dest, source: 'git', gitUrl: url })
    } else if (fs.existsSync(dest)) {
      return {
        ok: false,
        message: `目标目录已存在且不是 git 仓库，无法 clone：${dest}\n请先移走该目录后重试。`
      }
    } else {
      const r = await cloneRepo(url, dest)
      if (!r.ok) {
        const detail = r.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join('\n')
        return {
          ok: false,
          message:
            `clone 失败：${url}\n${detail}\n\n` +
            '若为私有仓库，请确认已在本机配置好 git 凭据（应用内不会弹出账号密码输入框）。'
        }
      }
      project = upsertProject({ name, path: dest, source: 'git', gitUrl: url })
    }
  } else {
    return { ok: false, message: '请选择项目：填写 git 地址、选择本地项目，或选择一个用过的项目。' }
  }

  // ---------- 2. 确保分支 ----------
  const branch = branchNameForVersion(input.version)
  const b = await ensureBranch(project.path, branch)
  if (!b.ok) {
    // 分支没弄好就不算准备好；但项目本身已登记，用户可修正后重试
    return { ok: false, project, branch, message: b.error ?? '切换分支失败。' }
  }

  touchProject(project.id)
  return {
    ok: true,
    project,
    branch,
    branchAction: b.action,
    message:
      b.action === 'created'
        ? `已创建并切换到分支 ${branch}`
        : b.action === 'switched'
          ? `已切换到已有分支 ${branch}`
          : `已在分支 ${branch}`
  }
}

/** 弹出目录选择器，返回选中路径 */
export async function pickDirectory(): Promise<string | null> {
  const r = await dialog.showOpenDialog({
    title: '选择本地 git 项目目录',
    properties: ['openDirectory', 'createDirectory']
  })
  if (r.canceled || r.filePaths.length === 0) return null
  return r.filePaths[0]
}

/** 供界面判断：已登记项目当前所在的 git 分支 */
export async function projectBranchOf(id: string): Promise<string | null> {
  const p = getProject(id)
  if (!p) return null
  return currentBranch(p.path)
}

