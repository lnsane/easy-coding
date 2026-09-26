/**
 * Provider 预设——与 PI-Desktop `packages/shared/src/provider-presets.ts` 的
 * NAMED_ENDPOINT_PRESETS 保持一致（id / vendorKey / name / baseUrl / apiStyle / aliases）。
 * API 样式取值见 PI-Desktop provider config schema：
 * chat_completions | responses | anthropic_messages | google_generative_ai | opencode_go | auto
 */

export type ApiStyle =
  | 'auto'
  | 'chat_completions'
  | 'responses'
  | 'anthropic_messages'
  | 'google_generative_ai'
  | 'opencode_go'

export interface ProviderPreset {
  id: string
  /** models.dev provider key，即 PI-Desktop 的 vendorKey */
  vendorKey: string
  name: string
  baseUrl: string
  apiStyle: Exclude<ApiStyle, 'auto'>
  aliases?: string[]
  /** Zhipu / Z.AI 系 Completions thinking/tool-stream 兼容标记 */
  zhipuCompat?: boolean
}

export const API_STYLE_OPTIONS: { value: ApiStyle; label: string }[] = [
  { value: 'auto', label: '自动（auto）' },
  { value: 'chat_completions', label: 'OpenAI Chat Completions' },
  { value: 'responses', label: 'OpenAI Responses' },
  { value: 'anthropic_messages', label: 'Anthropic Messages' },
  { value: 'google_generative_ai', label: 'Google Generative AI' },
  { value: 'opencode_go', label: 'OpenCode Go' }
]

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    vendorKey: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiStyle: 'responses'
  },
  {
    id: 'anthropic',
    vendorKey: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiStyle: 'anthropic_messages'
  },
  {
    id: 'google',
    vendorKey: 'google',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiStyle: 'google_generative_ai',
    aliases: ['gemini']
  },
  {
    id: 'openrouter',
    vendorKey: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiStyle: 'chat_completions'
  },
  {
    id: 'groq',
    vendorKey: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiStyle: 'chat_completions'
  },
  {
    id: 'xai',
    vendorKey: 'xai',
    name: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    apiStyle: 'chat_completions'
  },
  {
    id: 'mistral',
    vendorKey: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    apiStyle: 'chat_completions'
  },
  {
    id: 'togetherai',
    vendorKey: 'togetherai',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    apiStyle: 'chat_completions',
    aliases: ['together']
  },
  {
    id: 'fireworks-ai',
    vendorKey: 'fireworks-ai',
    name: 'Fireworks',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    apiStyle: 'chat_completions',
    aliases: ['fireworks']
  },
  {
    id: 'opencode_go',
    vendorKey: 'opencode-go',
    name: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    apiStyle: 'opencode_go'
  },
  {
    id: 'zai',
    vendorKey: 'zai',
    name: 'Z.AI',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    apiStyle: 'chat_completions',
    zhipuCompat: true
  },
  {
    id: 'zai-coding-plan',
    vendorKey: 'zai-coding-plan',
    name: 'Z.AI Coding Plan',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    apiStyle: 'chat_completions',
    zhipuCompat: true
  },
  {
    id: 'deepseek',
    vendorKey: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    apiStyle: 'chat_completions'
  },
  {
    id: 'alibaba-cn',
    vendorKey: 'alibaba-cn',
    name: 'Alibaba (China)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiStyle: 'chat_completions',
    aliases: ['dashscope', 'qwen']
  },
  {
    id: 'moonshotai-cn',
    vendorKey: 'moonshotai-cn',
    name: 'Moonshot AI (China)',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiStyle: 'chat_completions',
    aliases: ['moonshot']
  },
  {
    id: 'zhipuai',
    vendorKey: 'zhipuai',
    name: 'Zhipu AI',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiStyle: 'chat_completions',
    aliases: ['zhipu', 'bigmodel'],
    zhipuCompat: true
  },
  {
    id: 'zhipuai-coding-plan',
    vendorKey: 'zhipuai-coding-plan',
    name: 'Zhipu AI Coding Plan',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    apiStyle: 'chat_completions',
    aliases: ['zai-coding-cn'],
    zhipuCompat: true
  },
  {
    id: 'siliconflow-cn',
    vendorKey: 'siliconflow-cn',
    name: 'SiliconFlow (China)',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiStyle: 'chat_completions'
  },
  {
    id: 'volcengine',
    vendorKey: 'volcengine',
    name: 'Volcengine Ark',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiStyle: 'chat_completions',
    aliases: ['doubao', 'ark']
  },
  {
    id: 'minimax-cn',
    vendorKey: 'minimax-cn',
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/anthropic/v1',
    apiStyle: 'anthropic_messages',
    aliases: ['minimax']
  },
  {
    id: 'minimax-cn-openai',
    vendorKey: 'minimax-cn',
    name: 'MiniMax (OpenAI)',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiStyle: 'chat_completions',
    aliases: ['minimax-openai', 'minimax-compatible']
  },
  {
    id: 'xiaomi',
    vendorKey: 'xiaomi',
    name: 'Xiaomi',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    apiStyle: 'chat_completions',
    aliases: ['mimo', 'xiaomimimo']
  },
  {
    id: 'kimi-for-coding',
    vendorKey: 'kimi-for-coding',
    name: 'Kimi For Coding',
    baseUrl: 'https://api.kimi.com/coding/v1',
    apiStyle: 'anthropic_messages',
    aliases: ['kimi-coding', 'kimi']
  }
]

/** 自定义（OpenAI 兼容）入口，不在 PI-Desktop 命名预设内，相当于其 custom 类型 */
export const CUSTOM_PRESET: ProviderPreset = {
  id: 'custom',
  vendorKey: 'custom',
  name: '自定义（OpenAI 兼容）',
  baseUrl: '',
  apiStyle: 'chat_completions'
}

/** 下拉框完整选项：23 个命名预设 + 自定义 */
export const ALL_PRESET_OPTIONS: ProviderPreset[] = [...PROVIDER_PRESETS, CUSTOM_PRESET]
