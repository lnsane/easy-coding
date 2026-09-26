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
