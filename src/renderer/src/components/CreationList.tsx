import { useState } from 'react'
import { useConfigStore } from '../store'

interface Props {
  onOpen: (id: string) => void
  onNew: () => void
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 协作 tab 的列表态：顶部「新增创作」，下面是已建创作的卡片 */
export default function CreationList({ onOpen, onNew }: Props): React.JSX.Element {
  const creations = useConfigStore((s) => s.creations)
  const deleteCreation = useConfigStore((s) => s.deleteCreation)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
        <span className="text-xs text-zinc-500">
          共 {creations.length} 份创作
        </span>
        <button
          type="button"
          onClick={onNew}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs text-white transition hover:bg-indigo-500"
        >
          + 新增创作
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {creations.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-2xl">
              🤝
            </div>
            <p className="text-sm text-zinc-400">还没有创作</p>
            <p className="max-w-xs text-xs text-zinc-600">
              点击右上角「新增创作」，填写版本号与需求标题，开始写 markdown 需求文档
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {creations.map((c) => (
              <div
                key={c.id}
                onClick={() => onOpen(c.id)}
                className="group cursor-pointer rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition hover:border-zinc-700 hover:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="rounded bg-indigo-500/15 px-2 py-0.5 text-[11px] text-indigo-300">
                    v{c.version}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmId(c.id)
                    }}
                    className="shrink-0 text-[11px] text-zinc-600 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                  >
                    删除
                  </button>
                </div>
                <h3 className="mt-2 truncate text-sm font-medium text-zinc-100">{c.title}</h3>
                <p className="mt-1 line-clamp-2 min-h-8 text-xs text-zinc-500">
                  {c.content.trim() ? c.content.trim().slice(0, 80) : '（空白文档）'}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  {c.filePath && (
                    <span
                      className="truncate rounded bg-zinc-800/70 px-1.5 py-0.5 text-[10px] text-zinc-400"
                      title={c.filePath}
                    >
                      {c.filePath}
                    </span>
                  )}
                  {c.branch && (
                    <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
                      {c.branch}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] text-zinc-600">
                    {formatTime(c.updatedAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 删除二次确认 */}
      {confirmId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          onClick={() => setConfirmId(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-medium text-zinc-100">删除这份创作？</h3>
            <p className="mt-2 text-xs text-zinc-500">
              「{creations.find((c) => c.id === confirmId)?.title}」及其正文将被永久删除，无法恢复。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmId(null)}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = confirmId
                  setConfirmId(null)
                  if (id) void deleteCreation(id)
                }}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white transition hover:bg-red-500"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
