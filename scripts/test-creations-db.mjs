/**
 * creations 数据层的 CRUD 验证（L2）。
 *
 * 直接对 node:sqlite 建同名表结构跑一遍，验证：
 *   建表 / 插入 / 按更新时间排序 / 局部更新只改指定字段 /
 *   空值与字段保持 / 版本号去重聚合 / 删除。
 *
 * 用临时目录的库文件，不碰用户的 ~/.easyCode/config.db。
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

let pass = 0
const failures = []

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push({ name, actual: a, expected: e })
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easycode-test-'))
const file = path.join(dir, 'test.db')
const db = new DatabaseSync(file)

db.exec(`
  CREATE TABLE creations (
    id         TEXT PRIMARY KEY,
    version    TEXT NOT NULL,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_creations_version ON creations(version);
  CREATE INDEX idx_creations_updated ON creations(updated_at DESC);
`)

// ---- 与 db.ts 中同名函数的等价实现（保持逻辑一致） ----
const rowToCreation = (r) => ({
  id: r.id,
  version: r.version,
  title: r.title,
  content: r.content,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

function createCreation(input) {
  const now = Date.now()
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO creations (id, version, title, content, created_at, updated_at)
     VALUES (?, ?, ?, '', ?, ?)`
  ).run(id, input.version, input.title, now, now)
  return rowToCreation(db.prepare('SELECT * FROM creations WHERE id = ?').get(id))
}

function getCreation(id) {
  const r = db.prepare('SELECT * FROM creations WHERE id = ?').get(id)
  return r ? rowToCreation(r) : null
}

function listCreations() {
  return db
    .prepare('SELECT * FROM creations ORDER BY updated_at DESC')
    .all()
    .map(rowToCreation)
}

function updateCreation(id, patch) {
  const cur = getCreation(id)
  if (!cur) throw new Error('not found')
  const nextTitle = patch.title === undefined ? cur.title : patch.title
  const nextContent = patch.content === undefined ? cur.content : patch.content
  if (nextTitle === cur.title && nextContent === cur.content) return cur
  db.prepare('UPDATE creations SET title = ?, content = ?, updated_at = ? WHERE id = ?').run(
    nextTitle,
    nextContent,
    Date.now(),
    id
  )
  return getCreation(id)
}

function deleteCreation(id) {
  db.prepare('DELETE FROM creations WHERE id = ?').run(id)
}

function listCreationVersions() {
  return db
    .prepare(
      'SELECT version, MIN(created_at) AS first_at FROM creations GROUP BY version ORDER BY first_at ASC'
    )
    .all()
    .map((r) => r.version)
}

// ============================ 用例 ============================
const a = createCreation({ version: '1.0', title: '登录需求' })
check('新建：正文初始为空', a.content, '')
check('新建：版本号', a.version, '1.0')
check('新建：标题', a.title, '登录需求')
check('新建：createdAt 有值', typeof a.createdAt, 'number')
check('新建：updatedAt 与 createdAt 一致', a.updatedAt, a.createdAt)

const b = createCreation({ version: '1.1', title: '支付需求' })
const c = createCreation({ version: '1.0', title: '登录需求的补充' })
check('同一版本号可建多条', listCreations().filter((x) => x.version === '1.0').length, 2)

// 排序：刚建的排在前（updated_at 递减）
check('列表按更新时间倒序：最新在前', listCreations()[0].id, c.id)

// 局部更新：只给 content，title 必须保持不变
const b2 = updateCreation(b.id, { content: '# 正文' })
check('局部更新 content 后正文已改', b2.content, '# 正文')
check('局部更新 content 不影响 title', b2.title, '支付需求')
check('局部更新后版本号不变', b2.version, '1.1')

// 局部更新：只给 title，content 必须保持不变
const b3 = updateCreation(b.id, { title: '支付需求 v2' })
check('局部更新 title 后标题已改', b3.title, '支付需求 v2')
check('局部更新 title 不影响 content', b3.content, '# 正文')

// 更新后应排到最前
check('更新后列表重排：被更新的排最前', listCreations()[0].id, b.id)

// 无变化的更新不写库（updated_at 不动）
const b4 = updateCreation(b.id, { title: '支付需求 v2' })
check('无变化更新不抖动 updatedAt', b4.updatedAt, b3.updatedAt)

// 空字符串内容应被接受（用户清空文档）
const cleared = updateCreation(b.id, { content: '' })
check('可以清空正文', cleared.content, '')

// 版本号聚合去重，按首次使用时间
check('版本号去重聚合', listCreationVersions(), ['1.0', '1.1'])

// 不存在的 id
check('getCreation 不存在返回 null', getCreation('nope'), null)

// 删除
deleteCreation(c.id)
check('删除后条数', listCreations().length, 2)
check('删除的确实没了', getCreation(c.id), null)
// 删掉 1.0 里的一条，版本号仍在（还有另一条 1.0）
check('删一条后版本号仍在', listCreationVersions(), ['1.0', '1.1'])
deleteCreation(a.id)
check('该版本全部删完后版本号消失', listCreationVersions(), ['1.1'])

// 特殊字符与多行内容要能原样存取
const weird = createCreation({ version: "v'1\"2", title: '带 %s 与 \\ 反斜杠 `code`' })
const weirdBody = '# 标题\n\n| a | b |\n| --- | --- |\n\n```js\nconst x = "\u{1F600}"\n```'
const w2 = updateCreation(weird.id, { content: weirdBody })
check('特殊字符标题原样存取', w2.title, '带 %s 与 \\ 反斜杠 `code`')
check('特殊字符版本号原样存取', w2.version, "v'1\"2")
check('多行 + emoji + 代码块正文原样存取', w2.content, weirdBody)

db.close()
fs.rmSync(dir, { recursive: true, force: true })

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
