/**
 * 端到端验证（L9）：把应用实际会走的流程在真实仓库上跑一遍。
 *
 * 流程：ensureBranch（创建/切换）→ writeDocFile → 自动保存时 writeFileAt
 * → 切到新分支后 readFileAt 能读回。
 *
 * 这验证的是「模块之间串起来是否正确」，单测各自通过不代表串起来对。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { ensureBranch, currentBranch, branchNameForVersion, isClean } from '../src/main/git.ts'
import { writeDocFile, writeFileAt, readFileAt } from '../src/main/files.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push({ name, actual: a, expected: e })
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'easycode-e2e-'))
const proj = path.join(root, 'proj')
fs.mkdirSync(path.join(proj, 'doc'), { recursive: true })
const g = (args) => execFileSync('git', args, { cwd: proj, stdio: 'pipe' })

g(['init', '-q'])
g(['config', 'user.email', 't@e.com'])
g(['config', 'user.name', 'T'])
g(['config', 'commit.gpgsign', 'false'])
try {
  g(['checkout', '-q', '-b', 'main'])
} catch {
  /* 忽略 */
}
fs.writeFileSync(path.join(proj, 'README.md'), '# proj\n')
// 分���上预先存在的文档
fs.writeFileSync(path.join(proj, 'doc', '登录需求.md'), '# 已有的登录需求\n\n分支上本来就有的文档。\n')
g(['add', '.'])
g(['commit', '-q', '-m', 'init'])

const main = async () => {
  // ---------- 1. 版本 1.0 → 应创建分支 v1.0 ----------
  const branch = branchNameForVersion('1.0')
  check('版本号推导分支名', branch, 'v1.0')

  const b1 = await ensureBranch(proj, branch)
  check('创建分支成功', b1.ok, true)
  check('本次是新建', b1.action, 'created')
  check('当前在 v1.0', await currentBranch(proj), 'v1.0')

  // ---------- 2. 分支上已有文档应能读回（编辑器导入路径） ----------
  const existing = readFileAt(proj, 'doc/登录需求.md')
  check('能读回分支上已有文档', existing !== null && existing.includes('分支上本来就有的文档'), true)

  // ---------- 3. 新建创作 → 写 doc/ ----------
  const rel = writeDocFile(proj, '支付需求', '# 支付需求\n\n初稿')
  check('新文档写到 doc/ 下', rel.split(path.sep).join('/'), 'doc/支付需求.md')
  check('新文档内容正确', readFileAt(proj, rel), '# 支付需求\n\n初稿')

  // ---------- 4. 自动保存路径：writeFileAt 更新内容 ----------
  writeFileAt(proj, rel, '# 支付需求\n\n修改后的正文')
  check('自动保存后文件已更新', readFileAt(proj, rel), '# 支付需求\n\n修改后的正文')

  // ---------- 5. 同一版本号再建创作 → 应复用已存在分支 ----------
  const b2 = await ensureBranch(proj, 'v1.0')
  check('同分支复用不重复创建', b2.action, 'already')

  // ---------- 6. 换版本 2.0 → 新建分支，文档应随之隔离 ----------
  //  先提交，否则脏工作区会拒绝切换（这正是我们设计的行为）
  g(['add', '.'])
  g(['commit', '-q', '-m', 'v1.0 文档'])
  check('提交后工作区干净', await isClean(proj), true)

  const b3 = await ensureBranch(proj, 'v2.0')
  check('切到 v2.0 成功', b3.ok, true)
  check('v2.0 是新建的', b3.action, 'created')
  // v2.0 从 v1.0 分出来，文档会带过来（git 的正常行为）
  check('新分支上有从 v1.0 继承的文档', readFileAt(proj, rel) !== null, true)

  // ---------- 7. 回到 v1.0，内容应还在 ----------
  const b4 = await ensureBranch(proj, 'v1.0')
  check('切回 v1.0', b4.action, 'switched')
  check('v1.0 上文档内容完好', readFileAt(proj, rel), '# 支付需求\n\n修改后的正文')

  // ---------- 8. 未提交改动 → 拒绝切换 ----------
  writeFileAt(proj, rel, '# 未提交的改动')
  check('产生未提交改动', await isClean(proj), false)
  const b5 = await ensureBranch(proj, 'v2.0')
  check('有未提交改动时拒绝切换', b5.ok, false)
  check('拒绝后仍停在 v1.0', await currentBranch(proj), 'v1.0')
  check('未提交内容未被破坏', readFileAt(proj, rel), '# 未提交的改动')

  // ---------- 9. 文件确实存在且能被 git 看到 ----------
  // 注意两点：
  //  a) git ls-files 列的是**已跟踪**文件。应用只创建/切换分支、写文件，
  //     不做 commit（何时提交由用户决定），所以未提交的文档不会在这里出现。
  //  b) git 默认开启 quotepath，非 ASCII 文件名会输出成 "\347\231\273..." 这种
  //     八进制转义形式。要判断中文文件名必须关掉 quotepath，否则永远匹配不上。
  const gitOpt = { cwd: proj, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }
  const tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', 'doc/'], gitOpt)
  check('已提交的 doc/ 文件被 git 跟踪', tracked.includes('登录需求.md'), true)

  const status = execFileSync('git', ['-c', 'core.quotepath=false', 'status', '--porcelain'], gitOpt)
  check('未提交的新文档出现在 git status', status.includes('支付需求.md'), true)
  check('新文档在工作区实际存在', fs.existsSync(path.join(proj, 'doc', '支付需求.md')), true)

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
