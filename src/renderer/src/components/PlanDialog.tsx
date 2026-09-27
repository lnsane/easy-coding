import { useEffect, useRef, useState } from 'react'

interface Props {
  /** 需求文档标题，用于推导默认文件名 */
  requirementTitle: string
  /** 项目名（未关联项目时为 null，此时只能生成不落盘） */
  projectName: string | null
  projectPath: string | null
  /** 当前分支 */
  branch: string | null
  onCancel: () => void
  /** 确认：planName 为不含扩展名的文件名 */
  onConfirm: (planName: string) => void
}

/**
 * 生成开发计划前的确认弹窗。
 *
 * 允许改文件名：默认是「开发计划-<需求标题>」，但用户可能想用别的命名。
 * 重名时主进程会自动追加序号，所以这里不需要做重名检查。
 */
export default function PlanDialog({
  requirementTitle,
  projectName,
  projectPath,
  branch,
  onCancel,
  onConfirm
}: Props): React.JSX.Element {
  const [name, setName] = useState(`开发计划-${requirementTitle}`)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = (): void => {
    const v = name.trim()
    if (!v) {
      setError('请填写文件名')
      inputRef.current?.focus()
      return
    }
    onConfirm(v)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 className="text-base font-medium text-zinc-100">生成开发计划文档</h2>
        <p className="mt-1 text-xs text-zinc-500">
          依据当前需求文档，生成一份可执行的开发计划（任务拆解 / 技术方案 / 风险 / 验收标准）
        </p>

        {/* 只读模式说明：与润色不同，这里不改任何文件 */}
        <div className="mt-4 rounded-lg border border-zinc-700 bg-zinc-950/50 p-3">
          <p className="text-[11px] leading-relaxed text-zinc-400">
            <strong className="text-zinc-300">只读模式</strong>：需求内容经管道送入，
            Claude Code 不授予任何工具，<strong className="text-zinc-300">改不了磁盘上的任何文件</strong>。
            计划内容由应用写入新文件。
          </p>
          {projectPath && (
            <p className="mt-1.5 text-[11px] text-zinc-500">
              新文件将创建在：<code className="break-all text-zinc-400">{projectPath}\doc\</code>
              {branch && <span className="ml-2 text-emerald-400">分支 {branch}</span>}
            </p>
          )}
        </div>

        {/* 需求来源 */}
        <div className="mt-3 space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-[11px]">
          <div className="flex gap-2">
            <span className="w-16 shrink-0 text-zinc-500">需求文档</span>
            <span className="text-zinc-300">{requirementTitle}</span>
          </div>
          <div className="flex gap-2">
            <span className="w-16 shrink-0 text-zinc-500">项目</span>
            <span className="text-zinc-300">{projectName ?? '（未关联，将只生成不落盘）'}</span>
          </div>
        </div>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs text-zinc-400">计划文档文件名</span>
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError('')
              }}
              placeholder="开发计划-xxx"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-indigo-500"
            />
            <span className="shrink-0 text-sm text-zinc-500">.md</span>
          </div>
          <span className="mt-1.5 block text-[11px] text-zinc-500">
            同名文件已存在时会自动追加序号，不会覆盖。
          </span>
        </label>

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white transition hover:bg-indigo-500"
          >
            生成
          </button>
        </div>
      </div>
    </div>
  )
}
