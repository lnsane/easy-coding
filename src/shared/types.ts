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
