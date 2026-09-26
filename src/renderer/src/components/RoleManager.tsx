import { useEffect, useState } from 'react'
import type { Role } from '../../../shared/types'
import { useConfigStore } from '../store'

type Draft = {
  id?: string
  name: string
  title: string
  duty: string
  prompt: string
}

const EMPTY: Draft = { name: '', title: '', duty: '', prompt: '' }

/**
 * 编排 tab：角色管理。
 *
 * 角色 = 名称 + 职位 + 职责 + 提示词。执行编排任务时，这套信息会组成
 * system prompt 交给 Claude Code，因此提示词质量直接决定产出质量。
 */
export default function RoleManager(): React.JSX.Element {
  const roles = useConfigStore((s) => s.roles)
  const loadRoles = useConfigStore((s) => s.loadRoles)
  const saveRole = useConfigStore((s) => s.saveRole)
  const deleteRole = useConfigStore((s) => s.deleteRole)
  const duplicateRole = useConfigStore((s) => s.duplicateRole)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void loadRoles()
  }, [loadRoles])

  // 首次加载后默认选中第一个
  useEffect(() => {
    if (!selectedId && roles.length > 0) setSelectedId(roles[0].id)
  }, [roles, selectedId])

  const selected = roles.find((r) => r.id === selectedId) ?? null

  const openEdit = (r: Role): void => {
    setSelectedId(r.id)
    setDraft({ id: r.id, name: r.name, title: r.title, duty: r.duty, prompt: r.prompt })
    setError('')
  }

  const openNew = (): void => {
    setSelectedId(null)
    setDraft({ ...EMPTY })
    setError('')
  }

  const submit = async (): Promise<void> => {
    if (!draft) return
    if (!draft.name.trim()) {
      setError('请填写角色名称')
      return
    }
    setBusy(true)
    try {
      const saved = await saveRole({
        id: draft.id,
        name: draft.name.trim(),
        title: draft.title.trim(),
        duty: draft.duty.trim(),
        prompt: draft.prompt
      })
      setSelectedId(saved.id)
      setDraft(null)
      setError('')
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-indigo-500 disabled:opacity-50'

  return (
    <div className="flex h-full">
      {/* 左：角色列表 */}
      <div className="flex w-60 shrink-0 flex-col border-r border-zinc-800">
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-xs font-medium text-zinc-300">角色</span>
          <button
            type="button"
            onClick={openNew}
            className="rounded-md bg-indigo-600 px-2 py-1 text-[11px] text-white transition hover:bg-indigo-500"
          >
            + 新建
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {roles.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => openEdit(r)}
              className={`mb-1 block w-full rounded-lg px-3 py-2 text-left transition ${
                selectedId === r.id ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-sm text-zinc-100">{r.name}</span>
                {r.builtin && (
                  <span className="shrink-0 rounded bg-zinc-700/60 px-1.5 py-0.5 text-[10px] text-zinc-400">
                    内置
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-zinc-500">{r.title || '—'}</div>
            </button>
          ))}
          {roles.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-zinc-600">暂无角色</p>
          )}
        </div>
      </div>

      {/* 右：详情 / 表单 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {draft ? (
          <div className="space-y-4">
            <h2 className="text-base font-medium text-zinc-100">
              {draft.id ? '编辑角色' : '新建角色'}
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs text-zinc-400">角色名称</span>
                <input
                  value={draft.name}
                  disabled={busy}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="如 前端工程师"
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs text-zinc-400">职位</span>
                <input
                  value={draft.title}
                  disabled={busy}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="如 高级前端开发"
                  className={inputCls}
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs text-zinc-400">职责</span>
              <textarea
                value={draft.duty}
                disabled={busy}
                rows={3}
                onChange={(e) => setDraft({ ...draft, duty: e.target.value })}
                placeholder="这个角色在这次编排里负责什么"
                className={inputCls}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs text-zinc-400">提示词</span>
              <textarea
                value={draft.prompt}
                disabled={busy}
                rows={8}
                onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
                placeholder="作为 system prompt 交给 Claude Code，写得越具体产出越准"
                className={`${inputCls} font-mono text-xs`}
              />
              <span className="mt-1.5 block text-[11px] text-zinc-500">
                执行时这段会追加到系统提示中，与「先读需求文档、遵循项目现有风格、不自动 commit」等基础规则叠加。
              </span>
            </label>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDraft(null)
                  setError('')
                }}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        ) : selected ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-medium text-zinc-100">{selected.name}</h2>
                <p className="mt-0.5 text-xs text-zinc-500">{selected.title || '未设置职位'}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => openEdit(selected)}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800"
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => void duplicateRole(selected.id)}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800"
                  title="内置角色不可删除，可复制一份再改"
                >
                  复制
                </button>
                {!selected.builtin && (
                  <button
                    type="button"
                    onClick={async () => {
                      const r = await deleteRole(selected.id)
                      if (!r.ok) setError(r.error ?? '删除失败')
                      else setSelectedId(null)
                    }}
                    className="rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-400 transition hover:bg-red-950/40"
                  >
                    删除
                  </button>
                )}
              </div>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="mb-1 text-[11px] text-zinc-500">职责</p>
              <p className="whitespace-pre-wrap text-sm text-zinc-300">
                {selected.duty || '（未填写）'}
              </p>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="mb-1 text-[11px] text-zinc-500">提示词</p>
              <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-400">
                {selected.prompt || '（未填写）'}
              </pre>
            </div>

            <p className="text-[11px] text-zinc-600">
              在「协作」里打开一份文档，即可用这个角色执行编排任务。
            </p>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">
            选择左侧角色查看，或点击「新建」
          </div>
        )}
      </div>
    </div>
  )
}
