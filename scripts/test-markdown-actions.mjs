/**
 * markdown-actions 纯函数的行为测试。
 *
 * 这些函数不含任何 DOM / CodeMirror 依赖，所以能直接用 node 跑：
 *   node scripts/test-markdown-actions.mjs
 *
 * 覆盖点：无选中 / 行内选中 / 跨行选中 / 选区从行中间开始 /
 * 已应用状态下再次点击应取消 / 多行列表编号重排 / 空文档等边界。
 */
import {
  bold,
  italic,
  strike,
  inlineCode,
  heading,
  unorderedList,
  orderedList,
  quote,
  table,
  codeBlock,
  link,
  image,
  horizontalRule,
  applyAction,
  diffRange
} from '../src/renderer/src/lib/markdown-actions.ts'

let pass = 0
const failures = []

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
  } else {
    failures.push({ name, actual: a, expected: e })
  }
}

/** 便捷构造：把选区用 | 标出来，如 "ab|cd" → { text:'abcd', start:2, end:2 } */
function sel(marked) {
  const start = marked.indexOf('|')
  const rest = marked.replace('|', '')
  const end = rest.indexOf('|')
  if (end >= 0) {
    return { text: rest.replace('|', ''), start, end }
  }
  return { text: rest, start, end: start }
}

function run(name, action, marked, expectedMarked) {
  const { text, start, end } = sel(marked)
  const r = action(text, start, end)
  // 校验 selectionStart/End 在合法范围内——越界是这类代码最常见的 bug
  if (
    r.selectionStart < 0 ||
    r.selectionEnd < r.selectionStart ||
    r.selectionEnd > r.text.length
  ) {
    failures.push({
      name: name + ' [选区越界]',
      actual: `start=${r.selectionStart} end=${r.selectionEnd} len=${r.text.length}`,
      expected: '0 <= start <= end <= len'
    })
    return
  }
  const caret =
    r.selectionStart === r.selectionEnd
      ? '|'
      : '|' + r.text.slice(r.selectionStart, r.selectionEnd) + '|'
  const out = r.text.slice(0, r.selectionStart) + caret + r.text.slice(r.selectionEnd)
  check(name, out, expectedMarked)
}

// ============================ 加粗 ============================
run('加粗·无选中', bold, 'ab|', 'ab**|**')
run('加粗·行内选中', bold, 'a|bc|d', 'a**|bc|**d')
run('加粗·选区含标记→取消', bold, '|**bc**|', '|bc|')
run('加粗·光标在标记内→取消', bold, '**b|c**', 'b|c')
run('加粗·空文档', bold, '|', '**|**')
run('加粗·文末', bold, 'abc|', 'abc**|**')
run('加粗·跨行选中', bold, 'a|b\ncd|e', 'a**|b\ncd|**e')

// ============================ 斜体 ============================
run('斜体·无选中', italic, 'ab|', 'ab*|*')
run('斜体·行内选中', italic, 'a|bc|d', 'a*|bc|*d')
run('斜体·选区含标记→取消', italic, '|*bc*|', '|bc|')

// ============================ 删除线 ============================
run('删除线·无选中', strike, 'ab|', 'ab~~|~~')
run('删除线·选中', strike, 'a|bc|d', 'a~~|bc|~~d')

// ============================ 行内代码 ============================
run('行内代码·无选中', inlineCode, 'ab|', 'ab`|`')
run('行内代码·选中', inlineCode, 'a|bc|d', 'a`|bc|`d')
run('行内代码·含空格不冲突', inlineCode, 'a|b c|d', 'a`|b c|`d')

// ============================ 标题 ============================
run('H1·行首无选中', heading(1), '|abc', '# |abc')
// 真正的「选区从行中间开始」→ 扩展到整行后按整块返回（选区覆盖被改的行）
run('H1·选区从行中间开始→扩展整行', heading(1), 'a|bc|\n', '|# abc|\n')
// 折叠光标在行中间 → 光标相对正文保持不动
run('H1·光标在行中间', heading(1), 'ab|c\n', '# ab|c\n')
run('H1·已是H1→取消', heading(1), '|# abc', '|abc')
run('H2·已是H1→改成H2', heading(2), '|# abc', '## |abc')
run('H1·多行选区→整块处理并选中', heading(1), '|a\nb|', '|# a\n# b|')
run('H1·空行不加前缀', heading(1), '|a\n\nb|', '|# a\n\n# b|')
run('H1·空文档', heading(1), '|', '# |')

// ============================ 无序列表 ============================
run('无序·行首', unorderedList, '|abc', '- |abc')
run('无序·已有→取消', unorderedList, '|- abc', '|abc')
run('无序·有序转无序', unorderedList, '|1. abc', '- |abc')
run('无序·多行选区→整块处理并选中', unorderedList, '|a\nb|', '|- a\n- b|')
run('无序·多行已有→全取消', unorderedList, '|- a\n- b|', '|a\nb|')
run('无序·选区从行中间开始→扩展整行', unorderedList, 'a|bc|\n', '|- abc|\n')
run('无序·光标在行中间', unorderedList, 'ab|c\n', '- ab|c\n')
run('无序·空行跳过', unorderedList, '|a\n\nb|', '|- a\n\n- b|')

// ============================ 有序列表 ============================
run('有序·行首', orderedList, '|abc', '1. |abc')
run('有序·已有→取消', orderedList, '|1. abc', '|abc')
run('有序·多行递增编号', orderedList, '|a\nb\nc|', '|1. a\n2. b\n3. c|')
// 全部行都已是有序项 → 按「切换」语义整体取消（与无序/引用按钮行为一致）
run('有序·已是完整列表→取消', orderedList, '|1. a\n1. b\n1. c|', '|a\nb\nc|')
// 混排（部分行有序号、部分没有）→ 统一重新编号
run('有序·混排→重新编号', orderedList, '|1. a\nb|', '|1. a\n2. b|')
run('有序·无序转有序', orderedList, '|- a\n- b|', '|1. a\n2. b|')
run('有序·光标在行中间', orderedList, 'ab|c\n', '1. ab|c\n')

// ============================ 引用 ============================
run('引用·行首', quote, '|abc', '> |abc')
run('引用·已有→取消', quote, '|> abc', '|abc')
run('引用·多行选区→整块处理并选中', quote, '|a\nb|', '|> a\n> b|')
run('引用·光标在行中间', quote, 'ab|c\n', '> ab|c\n')

// ============================ 表格 ============================
run(
  '表格·插入空表并选中第一格',
  table,
  'ab|',
  'ab\n\n| |列 1| | 列 2 | 列 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |'
)

// ============================ 代码块 ============================
run('代码块·无选中，光标在围栏内', codeBlock, 'ab|', 'ab\n\n```\n|\n```')
run('代码块·包裹选中', codeBlock, 'a|bc|d', 'a\n\n```\n|bc|\n```\nd')

// ============================ 链接 ============================
run('链接·无选中→选中链接文字', link, 'ab|', 'ab[|链接文字|](url)')
run('链接·有选中→选中url', link, 'a|bc|d', 'a[bc](|url|)d')

// ============================ 图片 ============================
run('图片·无选中→选中描述', image, 'ab|', 'ab![|图片描述|](url)')
run('图片·有选中→选中url', image, 'a|bc|d', 'a![bc](|url|)d')

// ============================ 分割线 ============================
run('分割线·文末', horizontalRule, 'ab|', 'ab\n\n---|')
run('分割线·空文档', horizontalRule, '|', '---|')

// ============================ 幂等 / 往返 ============================
// 加粗两次应回到原文（这是最容易出错的地方）
{
  const cases = ['|abc', 'a|bc|d', 'a|b\ncd|e']
  for (const c of cases) {
    const { text, start, end } = sel(c)
    const r1 = bold(text, start, end)
    const r2 = bold(r1.text, r1.selectionStart, r1.selectionEnd)
    check(`加粗两次还原: ${c}`, r2.text, text)
  }
}
{
  // 无序列表两次切换应还原
  for (const c of ['|abc', '|a\nb|', 'ab|c']) {
    const { text, start, end } = sel(c)
    const r1 = unorderedList(text, start, end)
    const r2 = unorderedList(r1.text, r1.selectionStart, r1.selectionEnd)
    check(`无序列表两次还原: ${c}`, r2.text, text)
  }
}
{
  // 标题两次切换应还原
  for (const c of ['|abc', 'ab|c']) {
    const { text, start, end } = sel(c)
    const r1 = heading(2)(text, start, end)
    const r2 = heading(2)(r1.text, r1.selectionStart, r1.selectionEnd)
    check(`H2 两次还原: ${c}`, r2.text, text)
  }
}

// ============================ diffRange ============================
{
  // 最小差异区间：只替换真正变了的那一段
  const cases = [
    ['abc', 'abc', '', 3, 3],
    ['abc', 'abXc', 'X', 2, 2],
    ['ab', 'ab', '', 2, 2],
    ['# a', '## a', '#', 1, 1],
    ['', 'abc', 'abc', 0, 0],
    ['abc', '', '', 0, 3]
  ]
  for (const [before, after, insert, from, to] of cases) {
    const r = diffRange(before, after)
    check(`diffRange(${JSON.stringify(before)},${JSON.stringify(after)})`, r, { from, to, insert })
    // 关键性质：把 diff 应用到 before 必须还原出 after
    const applied = before.slice(0, r.from) + r.insert + before.slice(r.to)
    check(`diffRange 还原 ${JSON.stringify(after)}`, applied, after)
  }
}

// ============================ applyAction 边界保护 ============================
{
  // 越界偏移不应抛错，且返回的选区必须落在新文本内
  const weird = [
    [0, 0, 'abc'],
    [-5, -5, 'abc'],
    [999, 999, 'abc'],
    [2, 1, 'abc'],
    [0, 999, 'abc']
  ]
  for (const [s, e, text] of weird) {
    try {
      const r = applyAction(bold, text, s, e)
      check(
        `applyAction 越界保护 (${s},${e})`,
        r.selectionStart >= 0 && r.selectionEnd >= r.selectionStart && r.selectionEnd <= r.text.length,
        true
      )
    } catch (err) {
      failures.push({ name: `applyAction 越界 (${s},${e}) 抛错`, actual: String(err), expected: '不抛错' })
    }
  }
}

// ============================ 输出 ============================
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
