// 与渲染进程共享的 AI 配置类型
// 字段对齐 PI-Desktop provider record：name / vendorKey / apiStyle / baseUrl / secret / model / enabled

import type { ApiStyle } from './provider-presets'

export interface AIConfig {
  id: string
  /** 用户起的配置名，如「公司 DeepSeek」 */
  name: string
  /** 预设 id（custom 表示自定义） */
  provider: string
  /** PI-Desktop 的 vendorKey，如 openai / moonshotai-cn / kimi-for-coding */
  vendorKey: string
  /** API 样式：chat_completions / responses / anthropic_messages / google_generative_ai / auto */
  apiStyle: ApiStyle
  apiKey: string
  baseUrl: string
  model: string
  enabled: boolean
  isActive: boolean
  createdAt: number
  updatedAt: number
}

/** 保存（新增/更新）时渲染层提交的 payload */
export interface AIConfigInput {
  id?: string
  name: string
  provider: string
  vendorKey: string
  apiStyle: ApiStyle
  apiKey: string
  baseUrl: string
  model: string
  enabled: boolean
}

/** 一条「创作」：某版本号下的一份 markdown 需求文档 */
export interface Creation {
  id: string
  /** 创作版本号，自由文本（如 1.0 / 1.1），与 app 版本号无关 */
  version: string
  /** 需求标题 */
  title: string
  /** markdown 正文（工作副本；同时会同步到项目 doc/ 下的文件） */
  content: string
  /** 关联项目 id；null = 未关联项目（仅存库） */
  projectId: string | null
  /** 相对项目根的文档路径，如 doc/登录需求.md */
  filePath: string | null
  /** 实际使用的 git 分支名，如 v1.0 */
  branch: string | null
  /** 默认绑定的编排角色 id；null = 未绑定，执行时再选 */
  roleId: string | null
  createdAt: number
  updatedAt: number
}

/** 新建创作时提交 */
export interface CreationInput {
  version: string
  title: string
  projectId?: string | null
  filePath?: string | null
  branch?: string | null
  /** 默认绑定的编排角色（可选；不传则不绑定） */
  roleId?: string | null
}

/** 更新创作：局部更新，未提供的字段不变 */
export interface CreationUpdate {
  title?: string
  content?: string
}

/** 已用过的项目 */
export interface Project {
  id: string
  name: string
  /** 本地绝对路径 */
  path: string
  source: 'git' | 'local'
  gitUrl: string | null
  createdAt: number
  lastUsedAt: number
}

/** 新建/登记项目 */
export interface ProjectInput {
  name: string
  path: string
  source: 'git' | 'local'
  gitUrl?: string | null
}

/** 准备项目（clone / 校验 + 确保分支）的结果 */
export interface PrepareProjectResult {
  ok: boolean
  project?: Project
  branch?: string
  /** 本次对分支做了什么 */
  branchAction?: 'created' | 'switched' | 'already'
  /** 面向用户的进展/错误说明 */
  message: string
}

// ===================== 编排 =====================

/** 编排角色 */
export interface Role {
  id: string
  /** 角色名，如「前端工程师」 */
  name: string
  /** 职位，如「高级前端开发」 */
  title: string
  /** 职责描述 */
  duty: string
  /** 该角色的提示词，执行时追加到 system prompt */
  prompt: string
  /** 内置角色不可删，可复制后修改 */
  builtin: boolean
  createdAt: number
  updatedAt: number
}

export interface RoleInput {
  id?: string
  name: string
  title: string
  duty: string
  prompt: string
}

/** 一次编排执行的日志条目 */
export interface RunLogEntry {
  kind: 'info' | 'cmd' | 'out' | 'err' | 'done'
  text: string
  at: number
}

/** 一次编排执行的元信息（会写进文档的执行记录） */
export interface RunMeta {
  roleId: string
  roleName: string
  roleTitle: string
  /** 执行时所在分支 */
  branch: string
  status: 'running' | 'ok' | 'failed' | 'cancelled'
  startedAt: number
  endedAt: number | null
  /** 受影响的文件（含新增） */
  changedFiles: string[]
  /** 人类可读的改动摘要 */
  changeSummary: string
  /** 执行前的 git HEAD，便于定位与回滚 */
  headBefore: string
  /** AI 的最终输出 */
  resultText: string
  error?: string
}

/** 执行记录（持久化） */
export interface RunRecord {
  id: string
  creationId: string
  roleId: string
  roleName: string
  branch: string
  status: RunMeta['status']
  startedAt: number
  endedAt: number | null
  changedFiles: string[]
  changeSummary: string
  headBefore: string
  resultText: string
  log: RunLogEntry[]
  error?: string
}

export interface OrchestrateResult {
  ok: boolean
  meta?: RunMeta
  stdout?: string
  error?: string
  startedAt: number
  endedAt: number
}
