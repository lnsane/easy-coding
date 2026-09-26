/**
 * Markdown 工具栏的文本变换逻辑。
 *
 * 设计要点：这里的函数全部是**纯函数**——输入「文本 + 选区」，输出「新文本 + 新选区」，
 * 不 import CodeMirror、不碰 DOM。这样每个动作都能用 node 直接跑断言测试，
 * 而不是只能靠手点界面来验证。
 *
 * 编辑器侧只做薄封装：读出 doc 与选区 → 调这里的函数 → 把结果 dispatch 回编辑器。
 */

export interface EditResult {
  text: string
  selectionStart: number
  selectionEnd: number
}

export type Action = (text: string, start: number, end: number) => EditResult

/** 选区扩展到整行边界（行首到行尾，不含换行符） */
function lineBounds(text: string, start: number, end: number): { from: number; to: number } {
  const from = text.lastIndexOf('\n', start - 1) + 1
  let to = text.indexOf('\n', end)
  if (to === -1) to = text.length
  return { from, to }
}

// ---------------------------------------------------------------- 行内包裹

/**
 * 在同一行内找出「包住 pos 的标记对」，返回 { open, close } 的起始偏移，找不到返回 null。
 *
 * 用于「光标停在 `**粗体**` 中间时点加粗 → 取消加粗」。
 * 采用从左到右贪心配对（第1-2、3-4…）。若标记出现次数为奇数，
 * 说明多是 `***文字***` 这类歧义嵌套，直接放弃（返回 null），
 * 交给后续分支去插入标记，避免剥错位置。
 */
function findEnclosingPair(
  line: string,
  pos: number,
  marker: string
): { open: number; close: number } | null {
  const positions: number[] = []
  let idx = line.indexOf(marker)
  while (idx !== -1) {
    positions.push(idx)
    idx = line.indexOf(marker, idx + marker.length)
  }
  if (positions.length === 0 || positions.length % 2 !== 0) return null

  for (let i = 0; i + 1 < positions.length; i += 2) {
    const open = positions[i]
    const close = positions[i + 1]
    const innerStart = open + marker.length
    if (pos >= innerStart && pos <= close) return { open, close }
  }
  return null
}

/**
 * 加粗 / 斜体 / 删除线 / 行内代码。
 * 处理顺序：选中内容自带标记 → 去掉；标记紧贴选区两侧 → 去掉；
 * 光标落在已有标记对内 → 去掉该对；无选中 → 插一对标记；其余 → 包裹选区。
 */
function wrapInline(marker: string): Action {
  const m = marker
  return (text, start, end) => {
    const before = text.slice(0, start)
    const after = text.slice(end)

    // 1) 选中的内容自己就带着标记（选中 `**粗**` 再点加粗）
    if (end - start >= m.length * 2) {
      const sel = text.slice(start, end)
      if (sel.startsWith(m) && sel.endsWith(m)) {
        const inner = sel.slice(m.length, sel.length - m.length)
        return {
          text: before + inner + after,
          selectionStart: start,
          selectionEnd: start + inner.length
        }
      }
    }

    // 2) 标记正好紧贴选区两侧（选中 `**粗体**` 的内容部分）
    if (before.endsWith(m) && after.startsWith(m)) {
      return {
        text: before.slice(0, before.length - m.length) + text.slice(start, end) + after.slice(m.length),
        selectionStart: start - m.length,
        selectionEnd: end - m.length
      }
    }

    // 3) 光标落在同一行内已有的标记对之中（`**粗|体**` 点加粗）→ 取消这一对
    if (start === end) {
      const lineFrom = text.lastIndexOf('\n', start - 1) + 1
      let lineTo = text.indexOf('\n', start)
      if (lineTo === -1) lineTo = text.length
      const line = text.slice(lineFrom, lineTo)
      const pair = findEnclosingPair(line, start - lineFrom, m)
      if (pair) {
        const openAbs = lineFrom + pair.open
        const closeAbs = lineFrom + pair.close
        const withoutOpen = text.slice(0, openAbs) + text.slice(openAbs + m.length)
        const closeShifted = closeAbs - m.length
        const next = withoutOpen.slice(0, closeShifted) + withoutOpen.slice(closeShifted + m.length)
        // 光标原在开口标记之后，故整体左移一个标记长度
        const caret = start - m.length
        return { text: next, selectionStart: caret, selectionEnd: caret }
      }
    }

    // 4) 无选中 → 插一对标记，光标落中间
    if (start === end) {
      const at = start + m.length
      return { text: before + m + m + after, selectionStart: at, selectionEnd: at }
    }

    // 5) 有选中 → 包裹
    return {
      text: before + m + text.slice(start, end) + m + after,
      selectionStart: start + m.length,
      selectionEnd: end + m.length
    }
  }
}

export const bold: Action = wrapInline('**')
export const italic: Action = wrapInline('*')
export const strike: Action = wrapInline('~~')
export const inlineCode: Action = wrapInline('`')

// ------------------------------------------------------------ 行首前缀类

interface LinePrefixSpec {
  /** 命中「已有该前缀」时返回匹配到的前缀，否则 null */
  match: (line: string) => string | null
  /** 要添加的前缀，i 为选区内的行序号（已跳过空行） */
  make: (i: number) => string
  /** 添加前先剥掉的「同类不同款」前缀（如有序列表切无序列表） */
  strip?: (line: string) => string
}

/** 行块内第 lineIdx 行的起始偏移 */
function lineStartOf(block: string, lineIdx: number): number {
  let start = 0
  let seen = 0
  for (let i = 0; i < block.length && seen < lineIdx; i++) {
    if (block[i] === '\n') {
      seen++
      start = i + 1
    }
  }
  return start
}

/**
 * 行首前缀的通用实现（标题 / 列表 / 引用）。
 *
 * 两条关键规则：
 * - **选区先扩展到整行**：否则选区从行中间开始时会产生「半行加前缀」的坏文档。
 * - **空行跳过**：不给空行加 `- `、`> ` 这类前缀。
 */
function toggleLinePrefix(spec: LinePrefixSpec): Action {
  return (text, start, end) => {
    const { from, to } = lineBounds(text, start, end)
    const block = text.slice(from, to)
    const lines = block.split('\n')
    const contentIdx = lines.map((l, i) => (l.trim() === '' ? -1 : i)).filter((i) => i >= 0)

    // 空行/空文档：没有可加前缀的正文，但用户点标题显然是想开始写标题，
    // 所以仍然插入前缀，把光标放到前缀之后。
    if (contentIdx.length === 0) {
      if (start !== end) return { text, selectionStart: start, selectionEnd: end }
      const prefix = spec.make(0)
      const at = from + prefix.length
      return {
        text: text.slice(0, from) + prefix + text.slice(to),
        selectionStart: at,
        selectionEnd: at
      }
    }

    const allMatch = contentIdx.every((i) => spec.match(lines[i]) !== null)
    const next = lines.slice()

    // 记录每行**实际**被去掉/加上的前缀长度。
    // 不能事后用 spec.match 反推：切换前缀款式时（`1. ` → `- `、`# ` → `## `）
    // match 会返回 null，反推出来的长度是错的（甚至会算出负数把光标搞越界）。
    const removedLen = lines.map(() => 0)
    const addedLen = lines.map(() => 0)

    if (allMatch) {
      for (const i of contentIdx) {
        const p = spec.match(lines[i])
        if (p) {
          removedLen[i] = p.length
          next[i] = lines[i].slice(p.length)
        }
      }
    } else {
      let n = 0
      for (const i of contentIdx) {
        let line = lines[i]
        const existed = spec.match(line)
        if (existed) {
          removedLen[i] = existed.length
          line = line.slice(existed.length)
        } else if (spec.strip) {
          const s = spec.strip(line)
          if (s) {
            removedLen[i] = s.length
            line = line.slice(s.length)
          }
        }
        const prefix = spec.make(n)
        addedLen[i] = prefix.length
        next[i] = prefix + line
        n++
      }
    }

    const newBlock = next.join('\n')
    const newText = text.slice(0, from) + newBlock + text.slice(to)

    // 非空选区 → 覆盖选中这几行的新内容，便于连续操作
    if (start !== end) {
      return { text: newText, selectionStart: from, selectionEnd: from + newBlock.length }
    }

    // 空选区 → 光标按「相对该行正文的偏移」平移。
    //
    // 规则：光标的行内偏移以**前缀之后**为原点。这样
    //   `|abc` 点 H1 → `# |abc`   （光标跟着正文走）
    //   `# |abc` 再点 H1 → `|abc` （往返一致）
    // 且 `# |abc` 点 H2 → `## |abc`（换级别时不会掉进前缀内部）。
    const inBlock = start - from
    const caretLineIdx = block.slice(0, inBlock).split('\n').length - 1
    const contentOffset = Math.max(
      0,
      Math.min(inBlock - lineStartOf(block, caretLineIdx) - removedLen[caretLineIdx], next[caretLineIdx].length - addedLen[caretLineIdx])
    )
    const caret = from + lineStartOf(newBlock, caretLineIdx) + addedLen[caretLineIdx] + contentOffset
    return { text: newText, selectionStart: caret, selectionEnd: caret }
  }
}

const HEADING_RE = /^#{1,6}\s+/
const ULIST_RE = /^[-*+]\s+/
const OLIST_RE = /^\d+\.\s+/
const QUOTE_RE = /^>\s?/

/** 标题 H1~H6：已是该级别则切回正文 */
export function heading(level: number): Action {
  const target = '#'.repeat(level)
  return toggleLinePrefix({
    match: (line) => {
      const m = line.match(HEADING_RE)
      if (!m) return null
      return m[0].trim() === target ? m[0] : null
    },
    make: () => target + ' ',
    strip: (line) => line.match(HEADING_RE)?.[0] ?? ''
  })
}

/** 无序列表：- / * / + 互认，已存在则整体去除 */
export const unorderedList: Action = toggleLinePrefix({
  match: (line) => line.match(ULIST_RE)?.[0] ?? null,
  make: () => '- ',
  strip: (line) => (line.match(ULIST_RE) ?? line.match(OLIST_RE))?.[0] ?? ''
})

/** 有序列表：逐行递增编号，已有则整体去除 */
export const orderedList: Action = toggleLinePrefix({
  match: (line) => line.match(OLIST_RE)?.[0] ?? null,
  make: (i) => `${i + 1}. `,
  strip: (line) => (line.match(OLIST_RE) ?? line.match(ULIST_RE))?.[0] ?? ''
})

/** 引用 */
export const quote: Action = toggleLinePrefix({
  match: (line) => line.match(QUOTE_RE)?.[0] ?? null,
  make: () => '> ',
  strip: (line) => line.match(QUOTE_RE)?.[0] ?? ''
})

// ---------------------------------------------------------------- 块级插入

/**
 * 在 pos 处插入一个独占若干行的块，自动补齐前后空行。
 * 返回插入后块的起始偏移（供调用方定位光标）。
 */
function insertBlockAt(
  text: string,
  pos: number,
  block: string
): { text: string; blockStart: number } {
  const before = text.slice(0, pos)
  const after = text.slice(pos)

  let lead = ''
  if (before.length === 0 || before.endsWith('\n\n')) lead = ''
  else if (before.endsWith('\n')) lead = '\n'
  else lead = '\n\n'

  // 块后面若已有空行就不补，避免越插越空
  const tail = after.length === 0 || after.startsWith('\n') ? '' : '\n'

  return {
    text: before + lead + block + tail + after,
    blockStart: before.length + lead.length
  }
}

const TABLE_TPL = ['| 列 1 | 列 2 | 列 3 |', '| --- | --- | --- |', '|  |  |  |', '|  |  |  |'].join(
  '\n'
)

/** 表格：插入 3 列空表，光标落在第一格「列 1」上便于直接改名 */
export const table: Action = (text, start) => {
  const { text: next, blockStart } = insertBlockAt(text, start, TABLE_TPL)
  const cell = blockStart + 2 // '| ' 之后就是「列 1」
  return { text: next, selectionStart: cell, selectionEnd: cell + 3 }
}

/** 代码块：三反引号围栏 */
export const codeBlock: Action = (text, start, end) => {
  if (start === end) {
    const block = '```\n\n```'
    const { text: next, blockStart } = insertBlockAt(text, start, block)
    const caret = blockStart + 4 // '```\n' 之后就是那个空行
    return { text: next, selectionStart: caret, selectionEnd: caret }
  }
  const sel = text.slice(start, end)
  const before = text.slice(0, start)
  const after = text.slice(end)
  const lead = before.length === 0 || before.endsWith('\n') ? '' : '\n\n'
  const wrapped = `${lead}\`\`\`\n${sel}\n\`\`\`\n`
  const selStart = before.length + lead.length + 4 // 跳过 '```\n'
  return {
    text: before + wrapped + after,
    selectionStart: selStart,
    selectionEnd: selStart + sel.length
  }
}

/** 超链接：无选中→选中「链接文字」；有选中→选中待填的 url */
export const link: Action = (text, start, end) => {
  const before = text.slice(0, start)
  const after = text.slice(end)
  if (start === end) {
    const label = '链接文字'
    const insert = `[${label}](url)`
    return { text: before + insert + after, selectionStart: start + 1, selectionEnd: start + 1 + label.length }
  }
  const sel = text.slice(start, end)
  const insert = `[${sel}](url)`
  return {
    text: before + insert + after,
    selectionStart: start + sel.length + 3,
    selectionEnd: start + sel.length + 6
  }
}

/** 图片 */
export const image: Action = (text, start, end) => {
  const before = text.slice(0, start)
  const after = text.slice(end)
  if (start === end) {
    const alt = '图片描述'
    const insert = `![${alt}](url)`
    return { text: before + insert + after, selectionStart: start + 2, selectionEnd: start + 2 + alt.length }
  }
  const sel = text.slice(start, end)
  const insert = `![${sel}](url)`
  return {
    text: before + insert + after,
    selectionStart: start + sel.length + 4,
    selectionEnd: start + sel.length + 7
  }
}

/** 分割线 */
export const horizontalRule: Action = (text, start) => {
  const { text: next, blockStart } = insertBlockAt(text, start, '---')
  const caret = blockStart + 3
  return { text: next, selectionStart: caret, selectionEnd: caret }
}

// ---------------------------------------------------------------- 调用入口

/**
 * 带边界保护的调用入口。编辑器传来的偏移可能因极端情况越界，
 * 这里统一夹到合法范围，保证返回的选区一定落在新文本内 ——
 * 选区越界会让 CodeMirror 直接抛错。
 */
export function applyAction(action: Action, text: string, start: number, end: number): EditResult {
  const len = text.length
  const s = Math.max(0, Math.min(start, len))
  const e = Math.max(s, Math.min(end, len))
  const r = action(text, s, e)
  const rl = r.text.length
  const rs = Math.max(0, Math.min(r.selectionStart, rl))
  const re = Math.max(rs, Math.min(r.selectionEnd, rl))
  return { text: r.text, selectionStart: rs, selectionEnd: re }
}

/**
 * 求 before → after 的最小变化区间。
 *
 * 编辑器里若直接整篇替换（from:0, to:len），撤销会被合并成一大步、
 * 且光标映射会乱；用最小区间能让 CodeMirror 的 history 与选区映射正常工作。
 */
export function diffRange(
  before: string,
  after: string
): { from: number; to: number; insert: string } {
  let from = 0
  const maxPrefix = Math.min(before.length, after.length)
  while (from < maxPrefix && before[from] === after[from]) from++

  let suffix = 0
  const maxSuffix = Math.min(before.length - from, after.length - from)
  while (
    suffix < maxSuffix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++
  }

  return {
    from,
    to: before.length - suffix,
    insert: after.slice(from, after.length - suffix)
  }
}
