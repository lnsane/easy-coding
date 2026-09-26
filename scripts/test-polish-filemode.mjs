/**
 * 润色「文件模式」验证（L11）。
 *
 * 需求：让 Claude Code 在工作目录下**自己按文件路径读文档**并润色，
 * 而不是把正文塞进 stdin。约束是「只能润色，不能改变里面具体的内容」。
 *
 * 必须证明三件事：
 *  1. 它真的读到了那个文件（能按路径取到内容）
 *  2. 它**改不了**磁盘上的文件（只给 Read，不给写工具）
 *  3. 输出只有润色后的正文，没有夹带解释
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push({ name, actual: a, expected: e })
}

const hashOf = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')

function runClaude(args, { cwd, stdin }) {
  try {
    const out = execFileSync('claude', args, {
      cwd,
      input: stdin,
      encoding: 'utf8',
      timeout: 220_000,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return { ok: true, stdout: out }
  } catch (err) {
    return { ok: false, stdout: err.stdout?.toString() ?? '', stderr: err.stderr?.toString() ?? '' }
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'easycode-fmode-'))
const proj = path.join(root, 'proj')
fs.mkdirSync(path.join(proj, 'doc'), { recursive: true })
fs.writeFileSync(
  path.join(proj, 'CLAUDE.md'),
  '# 项目约定\n\n术语：本项目统一写「登录」，不写「登陆」。\n'
)
const docRel = 'doc/登录需求.md'
const docAbs = path.join(proj, docRel)
const original =
  '# 登陆需求\n\n' +
  '用户输入手机号和密码后点击登陆按钮，系统验证身份。\n' +
  '如果密码不对就提示用户密码错误，三次错误锁定账号。\n' +
  '另外还要支持记住我功能，让用户下次不用在次输入密码。\n'
fs.writeFileSync(docAbs, original)

const SYS =
  '你是一个纯文本润色器，只做语言层面的润色。\n' +
  '只修正错别字、病句、标点误用和不通顺的表达，保持 markdown 结构与原意不变，不增删内容。\n' +
  '绝对不要修改任何文件，只把润色后的内容输出到回复里。\n' +
  '只输出润色后的文档全文，不要任何解释、前言、后记，也不要用代码围栏包裹。'

const main = () => {
  const before = hashOf(docAbs)

  // ---------- 1. 文件模式：按路径读取并润色 ----------
  const r = runClaude(
    ['-p', '--tools', 'Read', '--append-system-prompt', SYS],
    {
      cwd: proj,
      stdin: `请读取文件 \`${docRel}\`，按系统提示的要求润色其中的文字。只读这一个文件，不要读取其他文件，也不要修改任何文件。把润色后的完整内容直接输出。`
    }
  )
  check('文件模式执行成功', r.ok, true)
  check('它确实读到了该文件（润色了「登陆」）', r.stdout.includes('登录'), true)
  check('修正了「在次」→「再次」', r.stdout.includes('再次输入密码'), true)
  check('输出不含解释性前言', /^\s*#/.test(r.stdout), true)
  check('输出未被代码围栏整体包裹', r.stdout.trim().startsWith('```'), false)

  // ---------- 2. 关键约束：磁盘文件未被改动 ----------
  const after = hashOf(docAbs)
  check('磁盘文件未被改动（哈希一致）', after, before)
  check('磁盘内容仍是原文（含「登陆」「在次」）', fs.readFileSync(docAbs, 'utf8'), original)

  // ---------- 3. 即使明确命令它写文件，也改不动 ----------
  const r2 = runClaude(
    ['-p', '--tools', 'Read', '--append-system-prompt', SYS],
    {
      cwd: proj,
      stdin: `请读取 \`${docRel}\`，然后用 Write 工具把润色后的内容写回该文件覆盖它。`
    }
  )
  check('被要求写文件时仍未改动磁盘', hashOf(docAbs), before)
  check('磁盘内容依旧完好', fs.readFileSync(docAbs, 'utf8'), original)
  void r2

  // ---------- 4. 项目 CLAUDE.md 的术语约定生效 ----------
  //   CLAUDE.md 里要求统一写「登录」，正文里写的是「登陆」
  check('CLAUDE.md 的术语约定被遵守', r.stdout.includes('登录') && !r.stdout.includes('登陆'), true)

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
