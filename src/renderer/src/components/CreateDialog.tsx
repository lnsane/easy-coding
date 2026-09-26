import { useEffect, useMemo, useRef, useState } from 'react'
import type { Project } from '../../../shared/types'
import { useConfigStore } from '../store'

interface Props {
  /** 已用过的版本号，供下拉选择 */
  versions: string[]
  onCancel: () => void
  /** 确定：交给上层去准备项目、建分支、落文件 */
  onConfirm: (payload: {
    projectId: string | null
    gitUrl: string | null
    localPath: string | null
    version: string
    title: string
    /** 界面展示用的阶段文字 */
    onProgress: (text: string) => void
  }) => void
  /** 上层流程失败时的错误信息 */
  error?: string
  onErrorClear?: () => void
}

type SourceMode = 'existing' | 'git' | 'local'

/** 版本号 → 分支名，与主进程 branchNameForVersion 保持一致 */
function branchNameFor(version: string): string {
  const v = version.trim()
  if (!v) return ''
  return v.startsWith('v') ? v : `v${v}`
}

/**
 * 「新增创作」弹窗：项目（三选一）+ 版本号 + 需求标题。
 *
 * 项目来源三种：选已用过的、填 git 地址、选本地目录。
 * 版本号用原生 `<input list>` + `<datalist>`，既能从已有版本里选，
 * 也能直接敲新的。
 */
export default function CreateDialog({
  versions,
  onCancel,
  onConfirm,
  error: outerError,
  onErrorClear
}: Props): React.JSX.Element {
  const projects = useConfigStore((s) => s.projects)
  const loadProjects = useConfigStore((s) => s.loadProjects)

  const [mode, setMode] = useState<SourceMode>(projects.length > 0 ? 'existing' : 'git')
  const [projectId, setProjectId] = useState<string>(projects[0]?.id ?? '')
  const [gitUrl, setGitUrl] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [version, setVersion] = useState(versions[0] ?? '')
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  const versionRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  // 项目列表异步到位后，若当前没选中项则补选第一个
  useEffect(() => {
    if (mode === 'existing' && !projectId && projects.length > 0) {
      setProjectId(projects[0].id)
    }
  }, [mode, projectId, projects])

  useEffect(() => {
    versionRef.current?.focus()
  }, [])

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId]
  )
  const branch = branchNameFor(version)

  const pickDir = async (): Promise<void> => {
    const dir = await window.api.pickProjectDir()
    if (dir) setLocalPath(dir)
  }

  const submit = (): void => {
    const v = version.trim()
    const t = title.trim()

    if (mode === 'existing' && !selectedProject) {
      setError('请选择一个已用过的项目')
      return
    }
    if (mode === 'git' && !gitUrl.trim()) {
      setError('请填写 git 地址')
      return
    }
    if (mode === 'local' && !localPath.trim()) {
      setError('请选择本地项目目录')
      return
    }
    if (!v) {
      setError('请填写或选择版本号')
      versionRef.current?.focus()
      return
    }
    if (!t) {
      setError('请填写需求标题')
      titleRef.current?.focus()
      return
    }

    setError('')
    onErrorClear?.()
    setBusy(true)
    setProgress('正在准备项目…')
    onConfirm({
      projectId: mode === 'existing' ? selectedProject!.id : null,
      gitUrl: mode === 'git' ? gitUrl.trim() : null,
      localPath: mode === 'local' ? localPath.trim() : null,
      version: v,
      title: t,
      onProgress: setProgress
    })
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (busy) return
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  const inputCls =
    'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-indigo-500 disabled:opacity-50'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={() => !busy && onCancel()}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 className="text-base font-medium text-zinc-100">新增创作</h2>
        <p className="mt-1 text-xs text-zinc-500">
          选择项目并指定版本号，文档会写入项目的 doc/ 目录，并切到对应 git 分支
        </p>

        {/* ---------------- 项目 ---------------- */}
        <div className="mt-5">
          <span className="mb-1.5 block text-xs text-zinc-400">项目</span>

          <div className="mb-2 flex gap-1 rounded-lg bg-zinc-950 p-1">
            {(
              [
                ['existing', `用过的项目${projects.length ? ` (${projects.length})` : ''}`],
                ['git', 'git 地址'],
                ['local', '本地项目']
              ] as [SourceMode, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                disabled={busy || (key === 'existing' && projects.length === 0)}
                onClick={() => setMode(key)}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  mode === key
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'existing' && (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/50 p-1.5">
              {projects.map((p: Project) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy}
                  onClick={() => setProjectId(p.id)}
                  className={`block w-full rounded-md px-2.5 py-2 text-left transition disabled:opacity-50 ${
                    projectId === p.id ? 'bg-indigo-600/20 ring-1 ring-indigo-500/50' : 'hover:bg-zinc-800/60'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-zinc-100">{p.name}</span>
                    <span className="shrink-0 rounded bg-zinc-700/50 px-1.5 py-0.5 text-[10px] text-zinc-400">
                      {p.source === 'git' ? 'git' : '本地'}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-zinc-500" title={p.path}>
                    {p.path}
                  </div>
                </button>
              ))}
            </div>
          )}

          {mode === 'git' && (
            <input
              value={gitUrl}
              disabled={busy}
              onChange={(e) => setGitUrl(e.target.value)}
              placeholder="https://github.com/user/repo.git"
              className={inputCls}
            />
          )}

          {mode === 'local' && (
            <div className="flex gap-2">
              <input
                value={localPath}
                disabled={busy}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder="D:\code\my-project"
                className={inputCls}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void pickDir()}
                className="shrink-0 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
              >
                浏览…
              </button>
            </div>
          )}
        </div>

        {/* ---------------- 版本号 ---------------- */}
        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs text-zinc-400">版本号</span>
          <input
            ref={versionRef}
            list="creation-versions"
            value={version}
            disabled={busy}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="如 1.0"
            className={inputCls}
          />
          <datalist id="creation-versions">
            {versions.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          {branch && (
            <span className="mt-1.5 block text-[11px] text-zinc-500">
              将使用 git 分支 <code className="text-indigo-300">{branch}</code>
              （已存在则切换过去，不存在则创建）
            </span>
          )}
        </label>

        {/* ---------------- 标题 ---------------- */}
        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs text-zinc-400">需求标题</span>
          <input
            ref={titleRef}
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="如 用户登录与鉴权"
            className={inputCls}
          />
          <span className="mt-1.5 block text-[11px] text-zinc-500">
            文档将保存为 <code className="text-zinc-400">doc/{title.trim() || '标题'}.md</code>
          </span>
        </label>

        {(error || outerError) && (
          <p className="mt-3 whitespace-pre-wrap text-xs text-red-400">{error || outerError}</p>
        )}

        {busy && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-zinc-950/60 px-3 py-2">
            <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border border-zinc-500 border-t-transparent" />
            <span className="text-xs text-zinc-300">{progress || '处理中…'}</span>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? '处理中…' : '确定'}
          </button>
        </div>
      </div>
    </div>
  )
}
