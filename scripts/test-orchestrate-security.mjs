/**
 * 编排执行的安全与行为验证（L13）。
 *
 * 这是本项目**唯一会修改用户代码**的功能，安全性质必须有测试兜住，
 * 不能只靠代码注释声称。
 *
 * 必须证明：
 *  1. 工具白名单真的生效 —— 用 `--tools` 时模型**没有** Bash/Agent 等工具
 *     （用 `--allowedTools` 则会有，这是实测发现的真实缺口）
 *  2. 允许写时确实能改文件
 *  3. 中止能杀掉整棵进程树，不留孤儿
 *  4. `git status --porcelain` 能同时捕获「改动的」和「新增的」文件
 *     （`git diff --stat` 会漏掉新增文件，这是实测发现）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push({ name, actual: a, expected: e })
}

const CLAUDE = execFileSync('where', ['claude'], { encoding: 'utf8' })
  .split(/\r?\n/)[0]
  .trim()
const TOOLS = 'Read,Write,Edit,Glob,Grep'

function ask(label, args, prompt, cwd, timeoutMs = 200_000) {
  return execFileSync(CLAUDE, args, {
    cwd,
    input: prompt,
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['pipe', 'pipe', 'pipe']
  })
}

/**
 * 从模型自报的输出里解析出「工具名集合」。
 *
 * 不能在整段散文里做子串匹配：模型可能在说明文字里顺带提到某个工具名
 * （例如「我没有 Bash 工具」），那样会造成假阳性／假阴性。
 * 这里只取最后一行「逗号分隔的工具名」，并按大小写敏感的全词比对。
 */
function toolSet(out) {
  const lines = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  // 从后往前找第一行看起来像工具清单的（逗号分隔的标识符）
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    if (/^[A-Za-z][A-Za-z0-9]*(\s*,\s*[A-Za-z][A-Za-z0-9]*)+\s*\.?$/.test(l)) {
      return new Set(
        l
          .replace(/\.$/, '')
          .split(',')
          .map((x) => x.trim())
      )
    }
  }
  return new Set()
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'easycode-orch-'))
const proj = path.join(root, 'proj')
fs.mkdirSync(proj, { recursive: true })
const g = (args) => execFileSync('git', args, { cwd: proj, stdio: 'pipe' })
g(['init', '-q'])
g(['config', 'user.email', 't@e.com'])
g(['config', 'user.name', 'T'])
g(['config', 'commit.gpgsign', 'false'])
try { g(['checkout', '-q', '-b', 'main']) } catch { /* ignore */ }
fs.writeFileSync(path.join(proj, 'README.md'), '# proj\n')
g(['add', '.'])
g(['commit', '-q', '-m', 'init'])

const main = () => {
  // ============ 1. 工具白名单：--tools 是真白名单 ============
  {
    const out = ask('tools', ['-p', '--tools', TOOLS],
      '你现在可用的工具有哪些？只列工具名，逗号分隔，不要调用任何工具。', proj)
    const tools = toolSet(out)
    // 用解析出的工具集合判定，而不是在散文里做子串匹配
    check('--tools 下无 Bash', tools.has('Bash'), false)
    check('--tools 下无 PowerShell', tools.has('PowerShell'), false)
    check('--tools 下无 Agent', tools.has('Agent'), false)
    check('--tools 下确实只有白名单内的工具',
      [...tools].every((t) => TOOLS.split(',').includes(t)), true)
    check('--tools 下白名单工具都在', TOOLS.split(',').every((t) => tools.has(t)), true)
  }

  // ============ 2. 对照：--allowedTools 不是白名单（回归证据） ============
  {
    const out = ask('allowed', ['-p', '--allowedTools', TOOLS],
      '你现在可用的工具有哪些？只列工具名，逗号分隔，不要调用任何工具。', proj)
    const tools = toolSet(out)
    // 记录这个差异：allowedTools 下会出现白名单外的工具，证明它非白名单
    const extra = [...tools].filter((t) => !TOOLS.split(',').includes(t))
    check('对照：--allowedTools 下出现白名单外的工具（证明它非白名单）',
      extra.length > 0, true)
  }

  // ============ 3. 允许写时确实能改文件 ============
  {
    ask('write', ['-p', '--tools', TOOLS, '--permission-mode', 'acceptEdits'],
      '请在当前目录创建文件 made.js，内容为 `export const x = 1`。', proj)
    check('工具白名单允许写入时确实建了文件',
      fs.existsSync(path.join(proj, 'made.js')), true)
  }

  // ============ 3b. 组合仍不含 Bash（关键：write 与 restrict 并存） ============
  {
    const out = ask('combo', ['-p', '--tools', TOOLS, '--permission-mode', 'acceptEdits'],
      '你现在可用的工具有哪些？只列工具名，逗号分隔，不要调用工具。', proj)
    const tools = toolSet(out)
    check('组合下无 Bash', tools.has('Bash'), false)
    check('组合下无 PowerShell', tools.has('PowerShell'), false)
    check('组合下无 Agent', tools.has('Agent'), false)
  }

  // ============ 4. 不给写工具时改不动 ============
  {
    const before = fs.readFileSync(path.join(proj, 'README.md'), 'utf8')
    ask('readonly', ['-p', '--tools', 'Read'],
      '请用 Edit 或 Write 工具把 README.md 的内容改成 "HACKED"。', proj)
    check('仅 Read 时文件未被改动', fs.readFileSync(path.join(proj, 'README.md'), 'utf8'), before)
  }

  // ============ 5. 改动收集：status 能同时捕获改动与新增 ============
  {
    // 造一个「改动已跟踪文件」+「新增未跟踪文件」的状态
    fs.writeFileSync(path.join(proj, 'README.md'), '# proj\n\n新增一行\n')
    fs.writeFileSync(path.join(proj, 'brand-new.txt'), 'new\n')

    const status = execFileSync('git', ['-c', 'core.quotepath=false', 'status', '--porcelain'],
      { cwd: proj, encoding: 'utf8' })
    const diffStat = execFileSync('git', ['-c', 'core.quotepath=false', 'diff', '--stat'],
      { cwd: proj, encoding: 'utf8' })

    check('status 捕获到已跟踪文件的改动', status.includes('README.md'), true)
    check('status 捕获到新增的未跟踪文件', status.includes('brand-new.txt'), true)
    // 这是关键的回归证据：diff --stat 看不到新增文件
    check('diff --stat 看不到新增文件（故不能用它收集改动）',
      diffStat.includes('brand-new.txt'), false)
  }

  // ============ 6. 中止：杀整棵进程树，不留孤儿 ============
  {
    const listClaude = () => {
      try {
        const out = execFileSync('powershell',
          ['-NoProfile', '-Command',
           'Get-Process claude -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id'],
          { encoding: 'utf8' })
        return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      } catch {
        return []
      }
    }
    const before = new Set(listClaude())

    // 起一个会跑很久的任务，然后 taskkill /T
    const child = spawn(CLAUDE, ['-p', '--tools', 'Read'],
      { cwd: proj, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdout.on('data', () => {})
    child.stderr.on('data', () => {})
    child.stdin.write('请逐个读取目录下所有文件，并为每个文件写 800 字分析。')
    child.stdin.end()

    // 等它真正起来
    const start = Date.now()
    while (Date.now() - start < 6000) {
      // 忙等 6 秒让子进程启动
    }

    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' })
    } catch { /* 可能已退出 */ }

    const t = Date.now()
    while (Date.now() - t < 2000) { /* 等进程表更新 */ }

    const after = listClaude().filter((p) => !before.has(p))
    check('中止后无孤儿 claude 进程', after.length, 0)
  }

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
