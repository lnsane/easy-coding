/**
 * 生成开发计划 验证（L15）。
 *
 * 与润色的关键差别：这是「读需求 → 产出新文档」，用只读模式。
 * 必须证明：
 *  1. 能依据需求内容产出**结构完整**的开发计划（任务拆解 / 技术方案 / 风险 / 验收标准）
 *  2. 只读模式下它碰不到磁盘（改不了任何文件）
 *  3. 产出正文可直接作为 markdown 落盘（无夹带解释、无整篇围栏）
 *  4. 不编造需求：原文没写的，进「风险与依赖」而不是凭空发明
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync, spawn, execSync } from 'node:child_process'
import { PLAN_SYSTEM_PROMPT as SYS } from '../src/shared/prompts.ts'
import { cleanCliOutput } from '../src/main/cli-output.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push({ name, actual: a, expected: e })
}

const CLAUDE = execFileSync('where', ['claude'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim()
const hashOf = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')

// 直接复用实现里的 prompt：另抄一份会与实现漂移
// （本次就踩到——测试用旧措辞，于是「修好了实现但测试仍失败」）。

const REQ = `# 编排功能完善：支持对 Markdown 文档进行编排

## 背景与目标
完善编排功能，使其支持在编排中对 Markdown 文档进行开发。

## 功能点
### 1. 编排中的角色配置
支持选择一个角色，并配置职责、职位、提示词。

### 2. Markdown 编辑器的执行入口
在 Markdown 编辑器上方新增一个按钮，用于执行编排任务。

## 待确认
- 角色与文档的关系：文档级绑定还是执行时选择
- 执行结果是否回写到当前文档
`

function genPlan(content, cwd) {
  return new Promise((resolve) => {
    const c = spawn(CLAUDE, ['-p', '--tools', 'Read,Glob,Grep', '--append-system-prompt', SYS], {
      cwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let o = ''
    c.stdout.on('data', (d) => (o += d))
    c.stderr.on('data', (d) => (o += d))
    c.on('close', (code) => resolve({ code, out: o }))
    c.stdin.write(`下面是需求文档《编排功能完善》的内容，请据此生成开发计划。\n\n${content}`)
    c.stdin.end()
    setTimeout(() => {
      try {
        execSync(`taskkill /F /T /PID ${c.pid}`, { stdio: 'ignore' })
      } catch {
        /* ignore */
      }
    }, 400_000)
  })
}

const main = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'easycode-plan-'))
  const proj = path.join(root, 'proj')
  fs.mkdirSync(path.join(proj, 'doc'), { recursive: true })
  fs.writeFileSync(path.join(proj, 'doc', 'req.md'), REQ)
  fs.writeFileSync(path.join(proj, 'sentinel.txt'), 'DO-NOT-TOUCH\n')
  const sentinelHash = hashOf(path.join(proj, 'sentinel.txt'))

  const r = await genPlan(REQ, proj)
  // 用与主进程同一个清理函数，避免测试与实现漂移
  const plan = cleanCliOutput(r.out)

  check('生成成功（退出码 0）', r.code, 0)
  check('产出非空', plan.length > 300, true)

  // ---------- 结构完整性 ----------
  check('含标题', /^#\s/.test(plan), true)
  check('含「需求理解」', plan.includes('需求理解'), true)
  check('含「任务拆解」', plan.includes('任务拆解'), true)
  check('含「技术方案」', plan.includes('技术方案'), true)
  check('含「风险与依赖」', plan.includes('风险与依赖'), true)
  check('含「验收标准」', plan.includes('验收标准'), true)

  // ---------- 可直接落盘 ----------
  check('未被整篇代码围栏包裹', !/^```[\s\S]*```$/.test(plan), true)
  check('无前言性客套（不以「好的」等开头）', !/^(好的|当然|这是|以下是)/.test(plan), true)

  // ---------- 不编造需求 ----------
  // 需求里没有「导出 PDF」这类功能，计划里不应凭空出现
  check('未编造需求外的新功能（导出 PDF）', plan.includes('导出 PDF'), false)
  // 需求里明确列为「待确认」的两点，应出现在风险/待确认里
  check('把原文的待确认项纳入风险或待确认', /待确认|需确认|待明确/.test(plan), true)

  // ---------- 只读：磁盘未被改动 ----------
  check('哨兵文件未被改动', hashOf(path.join(proj, 'sentinel.txt')), sentinelHash)
  check('需求文档本身未被改动', fs.readFileSync(path.join(proj, 'doc', 'req.md'), 'utf8'), REQ)

  // 把生成的计划落盘，确认内容可用（模拟应用的写入步骤）
  const planPath = path.join(proj, 'doc', '开发计划-编排功能完善.md')
  fs.writeFileSync(planPath, plan, 'utf8')
  const back = fs.readFileSync(planPath, 'utf8')
  check('写入后读回一致', back, plan)
  check('落盘文件是有效 markdown', back.trimStart().startsWith('#'), true)

  fs.rmSync(root, { recursive: true, force: true })

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
}

void main()
