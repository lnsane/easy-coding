import { useState } from 'react'
import { ALL_PRESET_OPTIONS } from '../../../shared/provider-presets'
import type { AIConfig } from '../../../shared/types'
import { useConfigStore } from '../store'
import ConfigForm from './ConfigForm'

interface Props {
  onClose: () => void
}

/** 配置管理弹窗：左侧配置列表，右侧新增/编辑表单 */
export default function ConfigManager({ onClose }: Props): React.JSX.Element {
  const { configs, remove, activate } = useConfigStore()
  const [editing, setEditing] = useState<AIConfig | null>(null)
  const [adding, setAdding] = useState(false)

  const presetLabel = (id: string): string =>
    ALL_PRESET_OPTIONS.find((p) => p.id === id)?.name ?? id

  const showForm = adding || editing !== null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="flex h-[480px] w-full max-w-3xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左：配置列表 */}
        <div className="flex w-64 shrink-0 flex-col border-r border-zinc-800">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm font-medium text-zinc-300">AI 配置</span>
            <button
              onClick={() => {
                setEditing(null)
                setAdding(true)
              }}
              className="rounded-md bg-indigo-600 px-2 py-1 text-xs text-white transition hover:bg-indigo-500"
            >
              + 新增
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {configs.map((c) => (
              <div
                key={c.id}
                className={`group mb-1 cursor-pointer rounded-lg px-3 py-2 transition ${
                  editing?.id === c.id ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'
                }`}
                onClick={() => {
                  setAdding(false)
                  setEditing(c)
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="truncate text-sm">{c.name}</span>
                  <span className="ml-2 flex shrink-0 gap-1">
                    {c.isActive && (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400">
                        使用中
                      </span>
                    )}
                    {!c.enabled && (
                      <span className="rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] text-zinc-500">
                        已停用
                      </span>
                    )}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-zinc-500">
                    {presetLabel(c.provider)} · {c.model}
                  </span>
                  <span className="flex shrink-0 gap-2 opacity-0 transition group-hover:opacity-100">
                    {!c.isActive && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          void activate(c.id)
                        }}
                        className="text-xs text-indigo-400 hover:underline"
                      >
                        设为当前
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (editing?.id === c.id) setEditing(null)
                        void remove(c.id)
                      }}
                      className="text-xs text-red-400 hover:underline"
                    >
                      删除
                    </button>
                  </span>
                </div>
              </div>
            ))}
            {configs.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-zinc-600">暂无配置</p>
            )}
          </div>
        </div>

        {/* 右：详情 / 表单 */}
        <div className="flex flex-1 flex-col p-6">
          {showForm ? (
            <>
              <h2 className="mb-4 text-base font-medium">{editing ? '编辑配置' : '新增配置'}</h2>
              <div className="flex-1 overflow-y-auto pr-1">
                <ConfigForm
                  initial={editing ?? undefined}
                  onSaved={() => {
                    setAdding(false)
                    setEditing(null)
                  }}
                  onCancel={() => {
                    setAdding(false)
                    setEditing(null)
                  }}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-zinc-600">
              <p className="text-sm">选择左侧配置进行编辑，或点击「新增」</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
