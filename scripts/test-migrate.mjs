/**
 * 迁移验证（L8）：用**旧结构**的数据库跑一次真实的 initDb 迁移路径。
 *
 * 这是风险最高的未测路径：老用户的 ~/.easyCode/config.db 里已经有两张表
 * 和数据，新增的 creations 三列、projects 表必须能自动补上，
 * 且老数据不能丢。
 *
 * 做法：复刻 initDb 里的建表 + migrate 逻辑，对旧库执行，再校验结果。
 * （不直接 import db.ts，因为它依赖 electron 的 app 模块。）
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easycode-migrate-'))
const file = path.join(dir, 'config.db')

// ---------------- 1. 造一个「旧版本」数据库（v0.1.0 结构，无 creations 的 project 列）----------------
{
  const db = new DatabaseSync(file)
  db.exec(`
    CREATE TABLE ai_configs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL,
      api_key TEXT NOT NULL, base_url TEXT NOT NULL, model TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE creations (
      id TEXT PRIMARY KEY, version TEXT NOT NULL, title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
  `)
  const now = Date.now()
  db.prepare(
    `INSERT INTO ai_configs (id,name,provider,api_key,base_url,model,is_active,created_at,updated_at)
     VALUES ('cfg1','老配置','deepseek','k','https://api.deepseek.com','deepseek-chat',1,?,?)`
  ).run(now, now)
  db.prepare(
    `INSERT INTO creations (id,version,title,content,created_at,updated_at)
     VALUES ('c1','1.0','老创作','# 老内容',?,?)`
  ).run(now, now)
  db.close()
}

// ---------------- 2. 跑与 initDb 相同的建表 + 迁移逻辑 ----------------
function migrate(db) {
  // ai_configs 补列（v0.1.1）
  const cols = db.prepare('PRAGMA table_info(ai_configs)').all().map((c) => c.name)
  if (!cols.includes('vendor_key')) {
    db.exec("ALTER TABLE ai_configs ADD COLUMN vendor_key TEXT NOT NULL DEFAULT ''")
    db.exec('UPDATE ai_configs SET vendor_key = provider')
  }
  if (!cols.includes('api_style')) {
    db.exec("ALTER TABLE ai_configs ADD COLUMN api_style TEXT NOT NULL DEFAULT 'auto'")
  }
  if (!cols.includes('enabled')) {
    db.exec('ALTER TABLE ai_configs ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1')
  }
  // creations 补列（v0.4.0）
  const ccols = db.prepare('PRAGMA table_info(creations)').all().map((c) => c.name)
  if (!ccols.includes('project_id')) db.exec('ALTER TABLE creations ADD COLUMN project_id TEXT')
  if (!ccols.includes('file_path')) db.exec('ALTER TABLE creations ADD COLUMN file_path TEXT')
  if (!ccols.includes('branch')) db.exec('ALTER TABLE creations ADD COLUMN branch TEXT')
}

{
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  // 新表（与 db.ts 的 CREATE TABLE IF NOT EXISTS 一致）
  db.exec(`
    CREATE TABLE IF NOT EXISTS creations (
      id TEXT PRIMARY KEY, version TEXT NOT NULL, title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_creations_version ON creations(version);
    CREATE INDEX IF NOT EXISTS idx_creations_updated ON creations(updated_at DESC);
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL,
      source TEXT NOT NULL, git_url TEXT,
      created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
  `)
  migrate(db)

  // ---------------- 3. 校验迁移结果 ----------------
  const ccols = db.prepare('PRAGMA table_info(creations)').all().map((c) => c.name)
  check('creations 有三列 project_id', ccols.includes('project_id'), true)
  check('creations 有三列 file_path', ccols.includes('file_path'), true)
  check('creations 有三列 branch', ccols.includes('branch'), true)

  const acols = db.prepare('PRAGMA table_info(ai_configs)').all().map((c) => c.name)
  check('ai_configs 迁移到 12 列', acols.length, 12)
  check('ai_configs 有 vendor_key', acols.includes('vendor_key'), true)

  const pcols = db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name)
  check('projects 表已建', pcols.length > 0, true)
  check('projects 有 path 列', pcols.includes('path'), true)

  // 老数据必须完好
  const old = db.prepare('SELECT * FROM creations WHERE id = ?').get('c1')
  check('老创作内容未丢', old.content, '# 老内容')
  check('老创作标题未丢', old.title, '老创作')
  check('老创作新列为 null', old.project_id, null)
  check('老创作新列 file_path 为 null', old.file_path, null)
  check('老创作新列 branch 为 null', old.branch, null)

  const cfg = db.prepare('SELECT * FROM ai_configs WHERE id = ?').get('cfg1')
  check('老配置未丢', cfg.name, '老配置')
  check('老配置 vendor_key 已回填', cfg.vendor_key, 'deepseek')
  check('老配置 api_style 默认 auto', cfg.api_style, 'auto')
  check('老配置 enabled 默认 1', cfg.enabled, 1)

  // ---------------- 4. 迁移后新功能可用 ----------------
  const now = Date.now()
  db.prepare(
    `INSERT INTO projects (id,name,path,source,git_url,created_at,last_used_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run('p1', 'proj', 'D:/code/proj', 'git', 'https://x/y.git', now, now)

  // path 唯一索引应拦住重复登记
  let dupBlocked = false
  try {
    db.prepare(
      `INSERT INTO projects (id,name,path,source,git_url,created_at,last_used_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run('p2', 'proj2', 'D:/code/proj', 'git', null, now, now)
  } catch {
    dupBlocked = true
  }
  check('projects.path 唯一索引生效', dupBlocked, true)

  // 新创作可带项目信息
  db.prepare(
    `INSERT INTO creations (id,version,title,content,project_id,file_path,branch,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run('c2', '2.0', '新创作', 'x', 'p1', 'doc/新创作.md', 'v2.0', now, now)
  const neu = db.prepare('SELECT * FROM creations WHERE id = ?').get('c2')
  check('新创作 project_id 可存', neu.project_id, 'p1')
  check('新创作 file_path 可存', neu.file_path, 'doc/新创作.md')
  check('新创作 branch 可存', neu.branch, 'v2.0')

  // 重复跑一次迁移应幂等（不报错、不重复加列）
  migrate(db)
  const ccols2 = db.prepare('PRAGMA table_info(creations)').all().map((c) => c.name)
  check('迁移幂等：列数不变', ccols2.length, ccols.length)

  const rowCountBefore = db.prepare('SELECT COUNT(*) n FROM creations').get().n
  migrate(db)
  const rowCountAfter = db.prepare('SELECT COUNT(*) n FROM creations').get().n
  check('迁移不影响数据行数', rowCountAfter, rowCountBefore)

  db.close()
}

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
