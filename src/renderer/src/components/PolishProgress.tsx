import { useEffect, useRef } from 'react'

/** 与主进程 PolishLog 对应 */
export interface PolishLogEntry {
  kind: 'info' | 'cmd' | 'out' | 'err' | 'done'
  text: string
  at: number
}

interface Props {
  /** 执行中的阶段标题 */
  phase: string
  logs: PolishLogEntry[]
  /** 关联的项目路径（没关联则为 null） */
  projectPath: string | null
  onClose: () => void
}

const KIND_STYLE: Record<PolishLogEntry['kind'], string> = {
  info: 'text-zinc-400',
  cmd: 'text-indigo-300',
  out: 'text-zinc-500',
  err: 'text-amber-400',
  done: 'text-emerald-400'
}

const KIND_LABEL: Record<PolishLogEntry['kind'], string> = {
  info: '信息',
  cmd: '命令',
  out: '输出',
  err: '警告',
  done: '完成'
}

function fmtTime(at: number): string {
  const d = new Date(at)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * 润色执行过程面板：显示实际执行的命令、工作目录、子进程输出与耗时。
 *
 * 之所以要有它：单次润色要等几十秒，只有一个转圈图标的话，
 * 用户无法判断它是在正常工作还是卡死了，也看不出「到底在哪个目录下执行」。
 */
export default function PolishProgress({
  phase,
  logs,
  projectPath,
  onClose
}: Props): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)

  // 新日志到达时自动滚到底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [logs.length])

  const worked = logs.find((l) => l.kind === 'cmd')

  return (
    <div className="absolute inset-x-0 bottom-0 z-40 mx-4 mb-4 max-h-[45%] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950/95 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
        <span
          className={`inline-block h-3 w-3 shrink-0 animate-spin rounded-full border border-indigo-400 border-t-transparent ${
            phase === '执行中' ? '' : 'hidden'
          }`}
        />
        <span className="text-xs font-medium text-zinc-200">{phase}</span>
        <span className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-zinc-500">
            {worked ? `共 ${logs.length} 条` : '准备中'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-0.5 text-[11px] text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            收起
          </button>
        </span>
      </div>

      {/* 工作目录单独突出显示，这是用户最想确认的信息 */}
      <div className="border-b border-zinc-800 bg-zinc-900/60 px-4 py-2">
        <span className="text-[11px] text-zinc-500">工作目录：</span>
        <code className="text-[11px] text-zinc-300">
          {projectPath ?? '（未关联项目，使用应用默认目录）'}
        </code>
      </div>

      <div className="max-h-56 overflow-y-auto px-4 py-2 font-mono text-[11px] leading-relaxed">
        {logs.length === 0 && <div className="text-zinc-600">等待输出…</div>}
        {logs.map((l, i) => (
          <div key={i} className="flex gap-2">
            <span className="shrink-0 text-zinc-600">{fmtTime(l.at)}</span>
            <span className={`shrink-0 ${KIND_STYLE[l.kind]}`}>{KIND_LABEL[l.kind]}</span>
            <span className={`whitespace-pre-wrap break-all ${KIND_STYLE[l.kind]}`}>
              {l.text}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
