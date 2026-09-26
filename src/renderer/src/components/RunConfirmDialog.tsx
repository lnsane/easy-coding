import { useState } from 'react'
import type { Role } from '../../../shared/types'

interface Props {
  /** 项目名与路径 */
  projectName: string
  projectPath: string
  /** 文档相对项目根的路径 */
  docRelPath: string
  /** git 分支 */
  branch: string | null
  /** 可选角色 */
  roles: Role[]
  /** 默认选中的角色 id */
  defaultRoleId: string | null
  onCancel: () => void
  onConfirm: (role: Role) => void
}

/**
 * 执行编排任务前的确认弹窗。
 *
 * 这是本项目**唯一会修改用户代码**的操作，因此必须：
 *  1. 明确告诉用户「会改哪个目录下的文件」
 *  2. 让用户明确选择角色（角色决定 AI 的行为边界）
 *  3. 需要主动勾选确认，不能一路回车就开跑
 */
export default function RunConfirmDialog({
  projectName,
  projectPath,
  docRelPath,
  branch,
  roles,
  defaultRoleId,
  onCancel,
  onConfirm
}: Props): React.JSX.Element {
  const [roleId, setRoleId] = useState<string | null>(
    defaultRoleId ?? roles[0]?.id ?? null
  )
  const [ack, setAck] = useState(false)
  const role = roles.find((r) => r.id === roleId) ?? null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onCancel}
    >
      <div
        className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-medium text-zinc-100">执行编排任务</h2>
        <p className="mt-1 text-xs text-zinc-500">
          以当前文档为需求说明，让 AI 在项目里实现代码
        </p>

        {/* 风险提示：这条是重点，必须醒目 */}
        <div className="mt-4 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3">
          <p className="text-xs font-medium text-amber-300">⚠️ 将修改你的项目文件</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-amber-200/80">
            AI 会读取并<strong>修改</strong>下面这个目录下的文件：
          </p>
          <code className="mt-1.5 block break-all rounded bg-black/40 px-2 py-1 text-[11px] text-amber-200">
            {projectPath}
          </code>
          <p className="mt-1.5 text-[11px] leading-relaxed text-amber-200/80">
            它只能读写文件与检索，<strong>不能执行命令</strong>。
            <strong>不会自动提交</strong>，改动留在工作区由你 review。
            {branch && (
              <>
                {' '}
                当前在分支 <code className="text-amber-100">{branch}</code>，改坏了可用 git 回滚。
              </>
            )}
          </p>
        </div>

        {/* 需求来源 */}
        <div className="mt-4 space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-[11px]">
          <div className="flex gap-2">
            <span className="w-16 shrink-0 text-zinc-500">项目</span>
            <span className="text-zinc-300">{projectName}</span>
          </div>
          <div className="flex gap-2">
            <span className="w-16 shrink-0 text-zinc-500">需求文档</span>
            <code className="break-all text-zinc-300">{docRelPath}</code>
          </div>
          <div className="flex gap-2">
            <span className="w-16 shrink-0 text-zinc-500">分支</span>
            <code className="text-zinc-300">{branch ?? '（未知）'}</code>
          </div>
        </div>

        {/* 角色选择 */}
        <div className="mt-4">
          <span className="mb-1.5 block text-xs text-zinc-400">选择执行角色</span>
          {roles.length === 0 ? (
            <p className="text-xs text-zinc-500">
              还没有角色，请先到「编排」tab 创建或使用内置角色。
            </p>
          ) : (
            <div className="grid max-h-44 grid-cols-2 gap-2 overflow-y-auto">
              {roles.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRoleId(r.id)}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    roleId === r.id
                      ? 'border-emerald-600/60 bg-emerald-500/5'
                      : 'border-zinc-700 hover:bg-zinc-800/50'
                  }`}
                >
                  <div className="truncate text-xs text-zinc-100">{r.name}</div>
                  <div className="mt-0.5 truncate text-[10px] text-zinc-500">{r.title || '—'}</div>
                </button>
              ))}
            </div>
          )}
          {role && (
            <p className="mt-2 line-clamp-2 text-[11px] text-zinc-500">{role.duty}</p>
          )}
        </div>

        {/* 主动确认 */}
        <label className="mt-4 flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-emerald-600"
          />
          <span className="text-[11px] text-zinc-400">
            我了解这次执行会修改上述目录下的代码，并已确认当前工作区没有我不想被牵动的未提交改动。
          </span>
        </label>

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
            disabled={!ack || !role}
            onClick={() => role && onConfirm(role)}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            开始执行
          </button>
        </div>
      </div>
    </div>
  )
}
