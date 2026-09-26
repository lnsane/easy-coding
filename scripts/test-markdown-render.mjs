// 直接验证 lib/markdown-render.ts 的渲染 + 消毒行为
// 说明：本测试需要 jsdom（仅测试用，未列入 package.json 依赖）：
//   npm i --no-save jsdom && node scripts/test-markdown-render.mjs
// 之所以需要它，是因为 DOMPurify 依赖浏览器 DOM 才能工作。
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.DOMParser = dom.window.DOMParser
globalThis.Node = dom.window.Node
globalThis.Element = dom.window.Element
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.NodeFilter = dom.window.NodeFilter
// Node 24 的 globalThis.navigator 是只读 getter，用 defineProperty 覆盖
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true
})
const { renderMarkdown } = await import('../src/renderer/src/lib/markdown-render.ts')

let pass=0, fail=0
const t = (name, cond) => { if(cond){pass++} else {fail++; console.log('  ✗ '+name)} }

// 基础语法
t('标题渲染', renderMarkdown('# 标题').includes('<h1'))
t('加粗渲染', renderMarkdown('**粗**').includes('<strong>'))
t('斜体渲染', renderMarkdown('*斜*').includes('<em>'))
t('删除线渲染', renderMarkdown('~~删~~').includes('<del>'))
t('行内代码', renderMarkdown('`x`').includes('<code>'))
t('代码块', renderMarkdown('```\nlet a=1\n```').includes('<pre>'))
t('引用', renderMarkdown('> 引用').includes('<blockquote>'))
t('无序列表', renderMarkdown('- a\n- b').includes('<ul>'))
t('有序列表', renderMarkdown('1. a\n2. b').includes('<ol>'))
t('分割线', renderMarkdown('---').includes('<hr'))
const tbl = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')
t('表格', tbl.includes('<table>') && tbl.includes('<th>') && tbl.includes('<td>'))
t('链接', renderMarkdown('[文字](https://a.com)').includes('href="https://a.com"'))

// 空内容
t('空白内容返回空串', renderMarkdown('   ')==='')

// ==== XSS：这些必须被清掉 ====
const xss = [
  ['script 标签', '<script>alert(1)</script>', '<script'],
  ['img onerror', '<img src=x onerror="alert(1)">', 'onerror'],
  ['javascript: 链接', '[x](javascript:alert(1))', 'javascript:'],
  ['iframe', '<iframe src="evil"></iframe>', '<iframe'],
  ['svg onload', '<svg onload="alert(1)"></svg>', 'onload'],
  ['body onload', '<body onload="alert(1)">', 'onload'],
  ['eval 内联', '<a href="javascript:eval(1)">x</a>', 'javascript:'],
]
for (const [name, input, forbidden] of xss) {
  const out = renderMarkdown(input)
  t('XSS 拦截: '+name, !out.toLowerCase().includes(forbidden.toLowerCase()))
}

console.log(`\n通过 ${pass} 项` + (fail? `，失败 ${fail} 项`:'，全部通过 ✓'))
process.exit(fail?1:0)
