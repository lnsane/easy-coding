import { useState } from 'react'
import {
  ALL_PRESET_OPTIONS,
  API_STYLE_OPTIONS,
  type ApiStyle
} from '../../../shared/provider-presets'
import type { AIConfig, AIConfigInput } from '../../../shared/types'
import { useConfigStore } from '../store'

interface Props {
  /** 编辑已有配置时传入；新增则不传 */
  initial?: AIConfig
  submitLabel?: string
  onSaved?: () => void
  onCancel?: () => void
}

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500'

export default function ConfigForm({ initial, submitLabel = '保存', onSaved, onCancel }: Props): React.JSX.Element {
  const save = useConfigStore((s) => s.save)

  const [providerId, setProviderId] = useState(initial?.provider ?? ALL_PRESET_OPTIONS[0].id)
  const [name, setName] = useState(initial?.name ?? '')
  const [apiStyle, setApiStyle] = useState<ApiStyle>(initial?.apiStyle ?? ALL_PRESET_OPTIONS[0].apiStyle)
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? ALL_PRESET_OPTIONS[0].baseUrl)
  const [model, setModel] = useState(initial?.model ?? '')
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const onProviderChange = (id: string): void => {
    setProviderId(id)
    const p = ALL_PRESET_OPTIONS.find((x) => x.id === id)
    if (p) {
      setBaseUrl(p.baseUrl)
      setApiStyle(p.apiStyle)
      // 名称留空时跟随预设名，方便一键添加
      if (!name.trim()) setName(p.name)
    }
  }

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')
    if (!name.trim() || !apiKey.trim() || !baseUrl.trim() || !model.trim()) {
      setError('请填写完整的配置信息（名称 / API Key / Base URL / 模型 ID）')
      return
    }
    const preset = ALL_PRESET_OPTIONS.find((p) => p.id === providerId)
    const input: AIConfigInput = {
      id: initial?.id,
      name: name.trim(),
      provider: providerId,
      vendorKey: preset?.vendorKey ?? providerId,
      apiStyle,
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      enabled
    }
    setSaving(true)
    try {
      await save(input)
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-zinc-400">Provider 预设</span>
        <select className={inputCls} value={providerId} onChange={(e) => onProviderChange(e.target.value)}>
          {ALL_PRESET_OPTIONS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-zinc-400">名称</span>
        <input
          className={inputCls}
          placeholder="例如：Kimi For Coding"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-zinc-400">端点（Base URL）</span>
        <input
          className={inputCls}
          placeholder="https://api.example.com/v1"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-zinc-400">API 样式</span>
        <select className={inputCls} value={apiStyle} onChange={(e) => setApiStyle(e.target.value as ApiStyle)}>
          {API_STYLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-zinc-400">API Key</span>
        <input
          className={inputCls}
          type="password"
          placeholder="sk-…"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-zinc-400">模型 ID</span>
        <input
          className={inputCls}
          placeholder="例如：kimi-for-coding / deepseek-chat"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </label>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 accent-indigo-500"
        />
        启用该配置
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="mt-2 flex justify-end gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800"
          >
            取消
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? '保存中…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
