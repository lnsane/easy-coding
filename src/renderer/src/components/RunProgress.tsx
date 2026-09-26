import { useEffect, useRef } from 'react'

/**
 * 执行过程日志条目。
 * 润色与编排（执行编排任务）共用同一结构，便于复用同一套展示面板。
 */
export interface RunLogEntry {
  kind: 'info' | 'cmd' | 'out' | 'err' | 'done'
  text: string
  at: number
}

/** 兼容旧命名（润色侧仍按 PolishLogEntry 引用） */
export type PolishLogEntry = RunLogEntry

interface Props {
  /** 执行中的阶段标题 */
  phase: string
  logs: RunLogEntry[]
  /** 关联的项目路径（没关联则为 null） */
  projectPath: string | null
  onClose: () => void
  /** 是否显示「中止」按钮（编排任务可中止；润色一般不需要） */
  onAbort?: () => void
  /** 执行结束后显示的摘要，例如「共 3 个文件受影响」 */
  summary?: string
  /** 是否正在执行（决定转圈与中止按钮的可用性） */
  running?: boolean
}

const KIND_STYLE: Record<RunLogEntry['kind'], string> = {
  info: 'text-zinc-400',
  cmd: 'text-indigo-300',
  out: 'text-zinc-500',
  err: 'text-amber-400',
  done: 'text-emerald-400'
}

const KIND_LABEL: Record<RunLogEntry['kind'], string> = {
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
 * 执行过程面板：显示实际执行的命令、工作目录、子进程输出与耗时。
 *
 * 之所以要有它：单次执行要等几十秒到几分钟，只给一个转圈图标的话，
 * 用户无法判断它是在正常工作还是卡死了，也看不出「到底在哪个目录下执行」。
 */
export default function RunProgress({
  phase,
  logs,
  projectPath,
  onClose,
  onAbort,
  summary,
  running = true
}: Props): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)

  // 新日志到达时自动滚到底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [logs.length])

  const hasCmd = logs.some((l) => l.kind === 'cmd')

  return (
    <div className="absolute inset-x-0 bottom-0 z-40 mx-4 mb-4 flex max-h-[50%] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950/95 shadow-2xl backdrop-blur">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-4 py-2">
        {running && (
          <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border border-indigo-400 border-t-transparent" />
        )}
        <span className="text-xs font-medium text-zinc-200">{phase}</span>
        <span className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-zinc-500">{hasCmd ? `${logs.length} 条` : '准备中'}</span>
          {onAbort && running && (
            <button
              type="button"
              onClick={onAbort}
              className="rounded border border-red-800/60 px-2 py-0.5 text-[11px] text-red-400 transition hover:bg-red-950/50 hover:text-red-300"
            >
              中止
            </button>
          )}
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
      <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/60 px-4 py-2">
        <span className="text-[11px] text-zinc-500">工作目录：</span>
        <code className="text-[11px] text-zinc-300">
          {projectPath ?? '（未关联项目，使用应用默认目录）'}
        </code>
      </div>

      {summary && (
        <div className="shrink-0 border-b border-zinc-800 bg-emerald-950/20 px-4 py-2">
          <span className="text-[11px] text-zinc-500">结果：</span>
          <span className="text-[11px] text-emerald-300">{summary}</span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 font-mono text-[11px] leading-relaxed">
        {logs.length === 0 && <div className="text-zinc-600">等待输出…</div>}
        {logs.map((l, i) => (
          <div key={i} className="flex gap-2">
            <span className="shrink-0 text-zinc-600">{fmtTime(l.at)}</span>
            <span className={`shrink-0 ${KIND_STYLE[l.kind]}`}>{KIND_LABEL[l.kind]}</span>
            <span className={`whitespace-pre-wrap break-all ${KIND_STYLE[l.kind]}`}>{l.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
