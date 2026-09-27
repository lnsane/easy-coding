/**
 * killTree 验证（L16）。
 *
 * 背景：`child.kill()` 只杀直接子进程，`claude.exe` 会变成孤儿继续跑
 * （继续消耗 token）。这个坑在编排功能里踩过一次，但当时实现留在
 * orchestrate.ts 内部，导致 polish.ts 与 plan.ts 又各犯一次。
 *
 * 抽成共享模块后必须证明：
 *  1. 杀得掉：进程树被真正终止
 *  2. 不留孤儿：杀完后没有新的同名进程残留
 *  3. 对已退出的 PID 不抛错（幂等、可安全重入）
 *  4. 对 undefined / 空 PID 不抛错
 */
import { spawn, execFileSync, execSync } from 'node:child_process'
import { killTree } from '../src/main/kill-tree.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push({ name, actual: a, expected: e })
}

/** 当前存活的 claude 进程 PID 集合 */
function claudePids() {
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        'Get-Process claude -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id'
      ],
      { encoding: 'utf8' }
    )
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

const main = async () => {
  // ---------- 1) 对 undefined / 0 不抛错 ----------
  let threw = false
  try {
    killTree(undefined)
    killTree(0)
  } catch {
    threw = true
  }
  check('对 undefined / 0 不抛错', threw, false)

  // ---------- 2) 对已退出的 PID 不抛错（幂等） ----------
  {
    // 起一个立刻退出的进程，拿到一个已失效的 PID
    const dead = spawn(process.platform === 'win32' ? 'cmd' : 'true',
      process.platform === 'win32' ? ['/c', 'exit'] : [], { stdio: 'ignore' })
    await new Promise((r) => dead.on('close', r))
    let t = false
    try {
      killTree(dead.pid)
      killTree(dead.pid) // 再杀一次也应安全
    } catch {
      t = true
    }
    check('对已退出的 PID 不抛错（可重复调用）', t, false)
  }

  // ---------- 3) 真杀：起一个 claude 长任务，杀后不留孤儿 ----------
  if (process.platform === 'win32') {
    const CLAUDE = execFileSync('where', ['claude'], { encoding: 'utf8' })
      .split(/\r?\n/)[0]
      .trim()
    const before = new Set(claudePids())

    const child = spawn(CLAUDE, ['-p', '--tools', 'Read'], {
      cwd: process.cwd(),
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    child.stdout.on('data', () => {})
    child.stderr.on('data', () => {})
    child.stdin.write('请逐个读取项目里所有文件，并为每个文件写 800 字分析。')
    child.stdin.end()

    // 等它真正起来
    await new Promise((r) => setTimeout(r, 6000))

    const started = claudePids().filter((p) => !before.has(p))
    check('子进程确实起来了', started.length > 0, true)

    killTree(child.pid)
    await new Promise((r) => setTimeout(r, 2500))

    const orphans = claudePids().filter((p) => !before.has(p))
    check('killTree 后无孤儿进程残留', orphans.length, 0)
  } else {
    // 非 Windows 走进程组；用 sleep 起一个长任务验证
    const child = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' })
    await new Promise((r) => setTimeout(r, 500))
    killTree(child.pid, true)
    await new Promise((r) => setTimeout(r, 500))
    let alive = true
    try {
      process.kill(child.pid, 0)
    } catch {
      alive = false
    }
    check('POSIX 下进程组被终止', alive, false)
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
}

void main()
