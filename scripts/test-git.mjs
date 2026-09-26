/**
 * git 层行为测试（L6）。
 *
 * 用**真实临时仓库**跑，不用 mock——分支切换的边界情况
 * （空仓库无 commit、脏工作区、分支已存在）正是最容易出错的地方，
 * mock 测不出来。
 *
 * 运行：node scripts/test-git.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  runGit,
  repoNameFromUrl,
  isGitRepo,
  hasCommits,
  currentBranch,
  listBranches,
  isClean,
  ensureBranch,
  branchNameForVersion
} from '../src/main/git.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push({ name, actual: a, expected: e })
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'easycode-git-'))

/** 建一个已提交的仓库，返回路径 */
function makeRepo(name, { commit = true } = {}) {
  const dir = path.join(tmpRoot, name)
  fs.mkdirSync(dir, { recursive: true })
  const g = (args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  g(['init', '-q'])
  g(['config', 'user.email', 'test@example.com'])
  g(['config', 'user.name', 'Test'])
  g(['config', 'commit.gpgsign', 'false'])
  // 默认分支名因 git 版本/配置而异，统一成 main
  try {
    g(['checkout', '-q', '-b', 'main'])
  } catch {
    // 忽略
  }
  if (commit) {
    fs.writeFileSync(path.join(dir, 'README.md'), '# test\n')
    g(['add', '.'])
    g(['commit', '-q', '-m', 'init'])
  }
  return dir
}

const main = async () => {
  // ============================ 纯函数 ============================
  check('分支名 1.0 → v1.0', branchNameForVersion('1.0'), 'v1.0')
  check('分支名 1.1.2 → v1.1.2', branchNameForVersion('1.1.2'), 'v1.1.2')
  check('分支名已是 v 开头不重复加', branchNameForVersion('v2.0'), 'v2.0')
  check('分支名去空格', branchNameForVersion(' 3.0 '), 'v3.0')

  check('URL 解析 https+.git', repoNameFromUrl('https://github.com/a/b.git'), 'b')
  check('URL 解析 https 无 .git', repoNameFromUrl('https://github.com/a/b'), 'b')
  check('URL 解析 ssh scp 形式', repoNameFromUrl('git@github.com:a/b.git'), 'b')
  check('URL 解析 ssh:// 形式', repoNameFromUrl('ssh://git@host/a/b.git'), 'b')
  check('URL 解析带尾斜杠', repoNameFromUrl('https://host/a/b/'), 'b')
  check('URL 解析非法字符被净化', repoNameFromUrl('https://host/a/b c!.git'), 'b-c-')

  // ============================ 仓库检测 ============================
  const repo = makeRepo('repo1')
  check('isGitRepo 真仓库', await isGitRepo(repo), true)
  check('hasCommits 有提交', await hasCommits(repo), true)
  check('currentBranch 是 main', await currentBranch(repo), 'main')
  check('isClean 初始干净', await isClean(repo), true)

  const empty = makeRepo('empty', { commit: false })
  check('isGitRepo 空仓库', await isGitRepo(empty), true)
  check('hasCommits 空仓库为 false', await hasCommits(empty), false)

  const notRepo = path.join(tmpRoot, 'notrepo')
  fs.mkdirSync(notRepo, { recursive: true })
  check('isGitRepo 非仓库', await isGitRepo(notRepo), false)

  // ============================ ensureBranch ============================
  // 1) 新建分支
  {
    const r = await ensureBranch(repo, 'v1.0')
    check('新建分支成功', r.ok, true)
    check('新建分支 action=created', r.action, 'created')
    check('新建后确实在 v1.0', await currentBranch(repo), 'v1.0')
  }

  // 2) 再次调用同一分支 → already（不重复创建）
  {
    const r = await ensureBranch(repo, 'v1.0')
    check('已在目标分支 action=already', r.action, 'already')
  }

  // 3) 切回 main 再切到已存在的 v1.0 → switched
  {
    await runGit(['checkout', 'main'], repo)
    const r = await ensureBranch(repo, 'v1.0')
    check('已存在分支 action=switched', r.action, 'switched')
    check('切换后分支正确', await currentBranch(repo), 'v1.0')
  }

  // 4) 分支已存在时不重复创建（分支数不变）
  {
    const before = (await listBranches(repo)).length
    await ensureBranch(repo, 'v1.0')
    const after = (await listBranches(repo)).length
    check('已存在分支不重复创建', after, before)
  }

  // 5) 脏工作区 → 拒绝
  {
    await runGit(['checkout', 'main'], repo)
    fs.writeFileSync(path.join(repo, 'dirty.txt'), 'uncommitted')
    check('脏工作区 isClean=false', await isClean(repo), false)
    const r = await ensureBranch(repo, 'v2.0')
    check('脏工作区拒绝切换', r.ok, false)
    check('脏工作区错误提示含关键词', r.error.includes('未提交'), true)
    check('脏工作区未被切换（仍在 main）', await currentBranch(repo), 'main')
    check('脏工作区未创建分支 v2.0', (await listBranches(repo)).includes('v2.0'), false)
    // 清理
    fs.unlinkSync(path.join(repo, 'dirty.txt'))
  }

  // 6) 已跟踪文件的修改也算脏
  {
    fs.writeFileSync(path.join(repo, 'README.md'), '# changed\n')
    const r = await ensureBranch(repo, 'v2.0')
    check('已跟踪文件被改也拒绝', r.ok, false)
    execFileSync('git', ['checkout', '--', 'README.md'], { cwd: repo, stdio: 'pipe' })
  }

  // 7) 空仓库创建分支 → 明确报错（而不是抛原始 git 错误）
  {
    const r = await ensureBranch(empty, 'v1.0')
    check('空仓库创建分支失败', r.ok, false)
    check('空仓库错误提示说明原因', r.error.includes('没有任何提交'), true)
  }

  // 8) 非仓库路径 → 报错
  {
    const r = await ensureBranch(notRepo, 'v1.0')
    check('非仓库路径报错', r.ok, false)
    check('非仓库错误提示', r.error.includes('不是 git 仓库'), true)
  }

  // 9) 切回 main（干净状态）应成功
  {
    const r = await ensureBranch(repo, 'main')
    check('干净状态切回 main', r.ok, true)
    check('切回后分支正确', await currentBranch(repo), 'main')
  }

  // 10) 含空格与中文的路径也要能工作
  {
    const weird = makeRepo('项目 目录 with space')
    const r = await ensureBranch(weird, 'v9.9')
    check('含空格/中文路径可建分支', r.ok, true)
    check('含空格/中文路径分支正确', await currentBranch(weird), 'v9.9')
  }

  // 11) clone 本地仓库（用 file:// 协议模拟远程）
  {
    const dest = path.join(tmpRoot, 'cloned')
    const r = await runGit(['clone', `file://${repo.replace(/\\/g, '/')}`, dest], undefined, 60_000)
    check('clone 成功', r.ok, true)
    check('clone 后可识别为仓库', await isGitRepo(dest), true)
    check('clone 后能建分支', (await ensureBranch(dest, 'v5.0')).ok, true)
  }

  // 12) clone 不存在的地址 → 失败但不挂起（关键：不能卡死）
  {
    const started = Date.now()
    const r = await runGit(
      ['clone', 'https://invalid.invalid.invalid/nope/nope.git', path.join(tmpRoot, 'nope')],
      undefined,
      20_000
    )
    const elapsed = Date.now() - started
    check('clone 无效地址失败', r.ok, false)
    check('clone 无效地址未挂起（<20s）', elapsed < 20_000, true)
  }

  // 清理
  fs.rmSync(tmpRoot, { recursive: true, force: true })

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
