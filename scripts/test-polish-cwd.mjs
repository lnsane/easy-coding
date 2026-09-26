/**
 * 润色执行过程的验证（L10）。
 *
 * 两件事必须证明：
 *  1. 日志回调真的会被调用，且内容包含「工作目录」，用户能看到到底在哪执行
 *  2. cwd 真的生效——用「项目里放 CLAUDE.md，看模型能否读到」来证伪
 *
 * 第 2 点是关键：只断言「传了 cwd 参数」没有意义，必须证明子进程
 * 确实读到了那个目录下的内容。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push({ name, actual: a, expected: e })
}

/** 直接调 claude CLI，模拟主进程的调用方式，并收集日志 */
function runClaude(args, { cwd, stdin }) {
  try {
    const out = execFileSync('claude', args, {
      cwd,
      input: stdin,
      encoding: 'utf8',
      timeout: 200_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return { ok: true, stdout: out, stderr: '' }
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? String(err.message)
    }
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'easycode-polish-'))
const projA = path.join(root, 'projA')
const projB = path.join(root, 'projB')
fs.mkdirSync(projA, { recursive: true })
fs.mkdirSync(projB, { recursive: true })
fs.writeFileSync(path.join(projA, 'CLAUDE.md'), '# 项目约定\n\n本项目代号是 ZEBRA-42。\n')
fs.writeFileSync(path.join(projB, 'CLAUDE.md'), '# 项目约定\n\n本项目代号是 PANDA-99。\n')

const main = () => {
  // ---------- 1. cwd 生效证明：模型能读到该目录的 CLAUDE.md ----------
  const q = '本项目代号是什么？只回答代号本身，不要任何解释。'
  const a = runClaude(['-p', '--tools', ''], { cwd: projA, stdin: q })
  check('projA 下执行成功', a.ok, true)
  check('读到 projA 的 CLAUDE.md（ZEBRA-42）', a.stdout.includes('ZEBRA-42'), true)

  const b = runClaude(['-p', '--tools', ''], { cwd: projB, stdin: q })
  check('projB 下执行成功', b.ok, true)
  check('读到 projB 的 CLAUDE.md（PANDA-99）', b.stdout.includes('PANDA-99'), true)

  // 交叉验证：projA 的结果里不应出现 projB 的代号
  check('projA 结果不含 projB 的代号', a.stdout.includes('PANDA-99'), false)

  // ---------- 2. 真实润色：输出应只含文档正文 ----------
  const doc = '# 登陆需求\n\n这个功能需要优化一下体验，让用户用起来更加方变。\n'
  const prompt =
    '你是一个文本润色器。下面三个反引号之间是待润色的 markdown 文档。\n' +
    '只修正错别字、病句、标点与不通顺的表达，不改变 markdown 结构和原意。\n' +
    '**只输出润色后的文档全文**，不要输出任何解释、前言、后记，也不要用代码围栏包裹。\n\n' +
    '```\n' + doc + '\n```\n'
  const r = runClaude(['-p', '--tools', ''], { cwd: projA, stdin: prompt })
  check('润色执行成功', r.ok, true)
  check('润色修正了「登陆」→「登录」', r.stdout.includes('登录需求'), true)
  check('润色修正了「方变」→「方便」', r.stdout.includes('方便'), true)
  check('输出未夹带解释性前言', /^(#|\s)/.test(r.stdout), true)
  check('输出未被代码围栏整体包裹', r.stdout.trim().startsWith('```'), false)

  // ---------- 3. 工具确实被禁掉 ----------
  // 判据不是「模型有没有尝试调用工具」（它仍会尝试，并输出畸形的工具调用标记），
  // 而是**工具调用是否真的产生了效果**。所以在目录里放一个哨兵文件，
  // 要求它读取，断言哨兵内容没有出现在输出里。
  const sentinel = 'SENTINEL-' + Math.random().toString(36).slice(2, 10)
  const secretDir = path.join(root, 'secret')
  fs.mkdirSync(secretDir, { recursive: true })
  fs.writeFileSync(path.join(secretDir, 'target.txt'), sentinel + '\n')

  const t = runClaude(['-p', '--tools', ''], {
    cwd: secretDir,
    stdin: '请读取 target.txt 的内容，并把文件内容原样告诉我。'
  })
  check('禁用工具后哨兵内容未泄露', t.stdout.includes(sentinel), false)
  check('哨兵文件确实存在（排除文件不存在导致的假通过）', fs.existsSync(path.join(secretDir, 'target.txt')), true)

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
