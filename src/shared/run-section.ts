import type { RunMeta } from './types'

/** 把执行的原始输出整理成 markdown 追加块 */
export function buildRunSection(meta: RunMeta, docRelPath: string): string {
  const t = (ts: number): string => {
    const d = new Date(ts)
    const p = (n: number): string => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }
  const statusText =
    meta.status === 'ok' ? '成功' : meta.status === 'cancelled' ? '已中止' : '失败'
  const secs = meta.endedAt ? ((meta.endedAt - meta.startedAt) / 1000).toFixed(1) : '-'

  const lines: string[] = []
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push(`## 执行记录 · ${t(meta.startedAt)}`)
  lines.push('')
  lines.push(`- **角色**：${meta.roleName}${meta.roleTitle ? `（${meta.roleTitle}）` : ''}`)
  lines.push(`- **分支**：\`${meta.branch}\``)
  lines.push(`- **需求文档**：\`${docRelPath}\``)
  lines.push(`- **状态**：${statusText}　**耗时**：${secs}s`)
  lines.push(`- **改动**：${meta.changeSummary || '（无）'}`)
  lines.push('')

  if (meta.changedFiles.length) {
    lines.push('改动文件：')
    lines.push('')
    for (const f of meta.changedFiles) lines.push(`- \`${f}\``)
    lines.push('')
  }

  if (meta.resultText.trim()) {
    lines.push('执行结果：')
    lines.push('')
    lines.push(meta.resultText.trim())
    lines.push('')
  }

  if (meta.error) {
    lines.push(`> ⚠️ 错误：${meta.error}`)
    lines.push('')
  }

  return lines.join('\n')
}
