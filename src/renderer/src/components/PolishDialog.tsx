import { useState } from 'react'

interface Props {
  /** 润色前的原文 */
  original: string
  /** 润色后的结果 */
  polished: string
  onAccept: (result: string) => void
  onReject: () => void
}

/**
 * 润色结果确认弹窗：左右对照原文与润色稿，用户选择接受或撤回。
 *
 * 支持逐块应用（按段落比对差异），用户可只接受其中一部分改动。
 */
interface Block {
  kind: 'same' | 'changed'
  original: string
  polished: string
}

/**
 * 按空行把文档切成块并比对。
 *
 * 比对策略（先对齐、再兜底）：
 *
 * 1. **块数一致时按位置配对**。这是最常见的情形——润色只改文字不动结构，
 *    块数必然相同。按位置配对能把「删掉旧段 + 插入新段」合并成「一段被改写」，
 *    界面上一处改动就是一处，而不是拆成两条。
 * 2. 块数不一致（模型增删了段落）时，用最长公共子序列对齐，
 *    把未变的块锚定住，其余按增/删处理。
 *
 * 注意用「块内容是否完全相同」判断改动：对中文文档比逐字符 diff 合适得多，
 * 不会把一句话拆得七零八落。
 */
function buildBlocks(original: string, polished: string): Block[] {
  const split = (s: string): string[] =>
    s
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .filter(Boolean)

  const a = split(original)
  const b = split(polished)

  // 情形 1：块数一致 → 按位置配对
  if (a.length === b.length) {
    return a.map((block, i) =>
      block === b[i]
        ? { kind: 'same', original: block, polished: b[i] }
        : { kind: 'changed', original: block, polished: b[i] }
    )
  }

  // 情形 2：块数不一致 → LCS 对齐
  const blocks: Block[] = []
  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      blocks.push({ kind: 'same', original: a[i], polished: b[j] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      blocks.push({ kind: 'changed', original: a[i], polished: '' })
      i++
    } else {
      blocks.push({ kind: 'changed', original: '', polished: b[j] })
      j++
    }
  }
  while (i < n) blocks.push({ kind: 'changed', original: a[i++], polished: '' })
  while (j < m) blocks.push({ kind: 'changed', original: '', polished: b[j++] })

  return blocks
}

export default function PolishDialog({
  original,
  polished,
  onAccept,
  onReject
}: Props): React.JSX.Element {
  const blocks = buildBlocks(original, polished)
  const changedIdx = blocks.map((b, i) => (b.kind === 'changed' ? i : -1)).filter((i) => i >= 0)
  const [accepted, setAccepted] = useState<Set<number>>(new Set(changedIdx))

  const toggle = (idx: number): void => {
    setAccepted((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  /**
   * 按用户的选择拼出最终文档。
   *
   * 拼接时有个必须注意的点：块是按空行切分的，而**块之间的原始分隔符**
   * （一个换行、两个换行还是更多）各不相同。若一律用 '\n\n' 拼回去，
   * 会把用户原本的排版悄悄改掉。因此这里记录每个块在原文中的位置，
   * 保留其间的**原始分隔符**，只替换块内容本身。
   */
  const composeResult = (): string => {
    // 极简情形直接返回，避免任何拼接误差
    if (changedIdx.length === 0) return original
    if (accepted.size === changedIdx.length) return polished

    // 定位每个块在原文中的区间
    const spans: { start: number; end: number }[] = []
    let cursor = 0
    for (const b of blocks) {
      if (!b.original) {
        // 纯新增块（润色稿里多出来的），没有原文位置，跳过
        spans.push({ start: -1, end: -1 })
        continue
      }
      const at = original.indexOf(b.original, cursor)
      if (at === -1) {
        spans.push({ start: -1, end: -1 })
        continue
      }
      spans.push({ start: at, end: at + b.original.length })
      cursor = at + b.original.length
    }

    let out = ''
    let pos = 0
    blocks.forEach((b, i) => {
      const span = spans[i]
      if (b.kind === 'same') {
        if (span.start === -1) return
        // 补上「上一个块结束」到「本块开始」之间的原始分隔符
        out += original.slice(pos, span.start) + b.original
        pos = span.end
        return
      }
      // 改动块
      if (span.start === -1) {
        // 纯新增：插在当前位置，前面补空行
        if (accepted.has(i) && b.polished) out += (out ? '\n\n' : '') + b.polished
        return
      }
      const keep = !accepted.has(i)
      const replacement = keep ? b.original : b.polished
      out += original.slice(pos, span.start) + replacement
      pos = span.end
    })
    // 收尾：补上最后一个块之后残留的内容
    out += original.slice(pos)
    return out
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="flex h-[80vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-3">
          <div>
            <h2 className="text-sm font-medium text-zinc-100">润色结果确认</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              共 {changedIdx.length} 处改动，已选 {accepted.size} 处。
              点选可逐处接受/撤回，确认后替换当前文档。
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAccepted(new Set(changedIdx))}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800"
            >
              全选
            </button>
            <button
              type="button"
              onClick={() => setAccepted(new Set())}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800"
            >
              全不选
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {changedIdx.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm text-zinc-400">没有检测到改动</p>
              <p className="text-xs text-zinc-600">Claude Code 认为这份文档无需润色</p>
            </div>
          ) : (
            <div className="space-y-2">
              {blocks.map((b, i) => {
                if (b.kind === 'same') {
                  return (
                    <div
                      key={i}
                      className="rounded-lg border border-transparent bg-zinc-950/40 px-3 py-2"
                    >
                      <pre className="whitespace-pre-wrap font-sans text-xs text-zinc-500">
                        {b.original}
                      </pre>
                    </div>
                  )
                }
                const on = accepted.has(i)
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggle(i)}
                    className={`block w-full rounded-lg border px-3 py-2 text-left transition ${
                      on
                        ? 'border-emerald-600/60 bg-emerald-500/5'
                        : 'border-zinc-700 bg-zinc-950/40'
                    }`}
                  >
                    <div className="mb-1.5 flex items-center gap-2">
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                          on
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : 'border-zinc-600 text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                      <span className="text-[11px] text-zinc-500">
                        {on ? '将采用润色稿' : '保留原文'}
                      </span>
                    </div>
                    {b.original && (
                      <pre className="mb-1 whitespace-pre-wrap font-sans text-xs text-red-300/70 line-through">
                        {b.original}
                      </pre>
                    )}
                    {b.polished && (
                      <pre className="whitespace-pre-wrap font-sans text-xs text-emerald-300">
                        {b.polished}
                      </pre>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button
            type="button"
            onClick={onReject}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800"
          >
            撤回（保留原文）
          </button>
          <button
            type="button"
            onClick={() => onAccept(composeResult())}
            disabled={accepted.size === 0}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            确认替换
          </button>
        </div>
      </div>
    </div>
  )
}
