/**
 * Claude Code CLI 输出里会混入的噪音行清理。
 *
 * 实测：stdout 首行可能带上诊断信息，形如
 *   [claude-code:unrecognized_model] {"model":"...","query_source":"generate_session_title"}
 *
 * 这是 Claude Code 自身打印的告警（模型名不被识别等），与模型产出无关，
 * 但它**混在 stdout 里**。若不过滤，会被当成正文的一部分写进文档——
 * 润色时它会被当成文档第一行，生成计划时会被当成标题前的杂讯。
 *
 * 之所以单独成模块：polish 与 plan 两条链路都会遇到，必须用同一套规则清理。
 */

/** 噪音行的特征：以 [claude-code: 开头的方括号诊断行 */
const NOISE_LINE = /^\s*\[claude-code:[^\]]*\]/

/**
 * 去掉输出开头/结尾的噪音行与多余空行。
 * 只处理**行首行尾**的噪音，不碰正文中间的内容——正文里若真有人
 * 写了类似的文字，那是用户内容，不该被我们改动。
 */
export function stripCliNoise(text: string): string {
  const lines = text.split(/\r?\n/)

  // 从头部去掉噪音行与空行
  let start = 0
  while (start < lines.length) {
    const l = lines[start]
    if (l.trim() === '' || NOISE_LINE.test(l)) start++
    else break
  }

  // 从尾部去掉噪音行与空行
  let end = lines.length - 1
  while (end >= start) {
    const l = lines[end]
    if (l.trim() === '' || NOISE_LINE.test(l)) end--
    else break
  }

  if (start > end) return ''
  return lines.slice(start, end + 1).join('\n')
}

/**
 * 去掉模型有时会自作主张加上的整篇代码围栏。
 * 只在「整篇被一对 ``` 包住」时才剥离，避免破坏文档内部本来就有的代码块。
 */
export function stripWrapper(text: string): string {
  const m = text.match(/^```[a-zA-Z]*\r?\n([\s\S]*)\r?\n```$/)
  if (m) return m[1]
  return text
}

/** 两步清理的合并入口：先去围栏，再去噪音 */
export function cleanCliOutput(text: string): string {
  return stripCliNoise(stripWrapper(text.trim()))
}
