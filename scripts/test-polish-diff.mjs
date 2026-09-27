/**
 * 润色确认弹窗的「分块比对 + 按选择拼回」逻辑测试（L5）。
 *
 * 这是最容易悄悄改坏用户文档的一环：
 * 拼回时若一律用 '\n\n' 连接，用户原本的单换行排版会被改掉。
 * 因此这里重点是**保真**——全不选必须逐字节等于原文，
 * 全选必须逐字节等于润色稿。
 *
 * 算法与 PolishDialog.tsx 保持同步。
 */

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push({ name, actual: a, expected: e })
}

function buildBlocks(original, polished) {
  const split = (s) =>
    s
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .filter(Boolean)
  const a = split(original)
  const b = split(polished)
  if (a.length === b.length) {
    return a.map((block, i) =>
      block === b[i]
        ? { kind: 'same', original: block, polished: b[i] }
        : { kind: 'changed', original: block, polished: b[i] }
    )
  }
  const blocks = []
  const n = a.length
  const m = b.length
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { blocks.push({ kind: 'same', original: a[i], polished: b[j] }); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { blocks.push({ kind: 'changed', original: a[i], polished: '' }); i++ }
    else { blocks.push({ kind: 'changed', original: '', polished: b[j] }); j++ }
  }
  while (i < n) blocks.push({ kind: 'changed', original: a[i++], polished: '' })
  while (j < m) blocks.push({ kind: 'changed', original: '', polished: b[j++] })
  return blocks
}

/** 复刻 PolishDialog.composeResult */
function compose(original, polished, accepted) {
  const blocks = buildBlocks(original, polished)
  const changedIdx = blocks.map((b, i) => (b.kind === 'changed' ? i : -1)).filter((i) => i >= 0)
  if (changedIdx.length === 0) return original
  if (accepted.size === changedIdx.length) return polished

  const spans = []
  let cursor = 0
  for (const b of blocks) {
    if (!b.original) {
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
  blocks.forEach((b, idx) => {
    const span = spans[idx]
    if (b.kind === 'same') {
      if (span.start === -1) return
      out += original.slice(pos, span.start) + b.original
      pos = span.end
      return
    }
    if (span.start === -1) {
      if (accepted.has(idx) && b.polished) out += (out ? '\n\n' : '') + b.polished
      return
    }
    const keep = !accepted.has(idx)
    out += original.slice(pos, span.start) + (keep ? b.original : b.polished)
    pos = span.end
  })
  out += original.slice(pos)
  return out
}

const allChanged = (original, polished) =>
  new Set(buildBlocks(original, polished).map((b, i) => (b.kind === 'changed' ? i : -1)).filter((i) => i >= 0))

// ============================ 保真性（最关键） ============================
{
  const original = '# 标题\n\n这是一段有错别子的文字。\n\n## 小节\n\n第二段内容。'
  const polished = '# 标题\n\n这是一段有错别字的文字。\n\n## 小节\n\n第二段内容。'
  check('全不选 → 逐字节等于原文', compose(original, polished, new Set()), original)
  check('全选 → 逐字节等于润色稿', compose(original, polished, allChanged(original, polished)), polished)
}

// 单换行排版必须原样保留（这是拼接最容易出错的地方）
{
  const original = '# 标题\n第一行\n第二行\n\n下一段'
  const polished = '# 标题\n第一行改了\n第二行\n\n下一段'
  const out = compose(original, polished, allChanged(original, polished))
  check('单换行排版不被打乱', out, polished)
  check('全不选仍是原文', compose(original, polished, new Set()), original)
}

// 三个及以上连续换行也要保留
{
  const original = 'A\n\n\n\nB'
  const polished = 'A改了\n\n\n\nB'
  const out = compose(original, polished, allChanged(original, polished))
  check('多余空行保留', out, polished)
  check('多余空行·全不选=原文', compose(original, polished, new Set()), original)
}

// ============================ 部分接受 ============================
{
  const original = '第一段有错字。\n\n第二段也有错字。'
  const polished = '第一段有错别字。\n\n第二段也有错别字。'
  const blocks = buildBlocks(original, polished)
  const changed = blocks.map((b, i) => (b.kind === 'changed' ? i : -1)).filter((i) => i >= 0)
  check('两段都被识别为改动', changed.length, 2)

  // 只接受第一处
  const onlyFirst = new Set([changed[0]])
  const out = compose(original, polished, onlyFirst)
  check('只接受第一处：第一段是润色稿', out.includes('第一段有错别字。'), true)
  check('只接受第一处：第二段保留原文', out.includes('第二段也有错字。'), true)
  check('只接受第一处：不含第二段的润色稿', out.includes('第二段也有错别字。'), false)
}

// ============================ 未改动 ============================
{
  const same = '# 一样\n\n内容也一样'
  check('完全无改动 → 返回原文', compose(same, same, new Set()), same)
}

// ============================ 结构保真：表格与代码块 ============================
{
  const original = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst x=1\n```'
  const polished = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst x = 1\n```'
  check('表格/代码块·全选', compose(original, polished, allChanged(original, polished)), polished)
  check('表格/代码块·全不选', compose(original, polished, new Set()), original)
}

// ============================ 新增块 ============================
{
  const original = '第一段。'
  const polished = '第一段。\n\n这是新增的一段。'
  const out = compose(original, polished, allChanged(original, polished))
  check('接受新增段落', out.includes('这是新增的一段。'), true)
  check('接受新增段落：原文保留', out.includes('第一段。'), true)
  check('撤回新增段落', compose(original, polished, new Set()), original)
}

// ============================ 删除块 ============================
{
  const original = '第一段。\n\n要被删掉的段落。'
  const polished = '第一段。'
  const out = compose(original, polished, allChanged(original, polished))
  check('接受删除：多余段落消失', out.includes('要被删掉的段落。'), false)
  check('撤回删除：段落还在', compose(original, polished, new Set()).includes('要被删掉的段落。'), true)
}

// ============================ 空文档 ============================
{
  check('空原文', compose('', '', new Set()), '')
}

console.log(`\n通过 ${pass} 项`)
if (failures.length) {
  console.log(`失败 ${failures.length} 项：\n`)
  for (const f of failures) {
    console.log(`  ✗ ${f.name}`)
    console.log(`      实际: ${f.actual}`)
    console.log(`      期望: ${f.expected}`)
  }
  process.exit(1)
}
console.log('全部通过 ✓')
