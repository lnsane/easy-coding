import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import type {
  AIConfig,
  AIConfigInput,
  Creation,
  CreationInput,
  CreationUpdate,
  Project,
  Role,
  RoleInput,
  RunRecord,
  RunLogEntry
} from '../shared/types'
import type { ApiStyle } from '../shared/provider-presets'

let db: DatabaseSync | null = null

interface ConfigRow {
  id: string
  name: string
  provider: string
  vendor_key: string
  api_style: string
  api_key: string
  base_url: string
  model: string
  enabled: number
  is_active: number
  created_at: number
  updated_at: number
}

function rowToConfig(row: ConfigRow): AIConfig {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    vendorKey: row.vendor_key,
    apiStyle: row.api_style as ApiStyle,
    apiKey: row.api_key,
    baseUrl: row.base_url,
    model: row.model,
    enabled: row.enabled === 1,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** 初始化 ~/.easyCode/config.db 并建表 + 迁移旧结构 */
export function initDb(): void {
  const dir = path.join(os.homedir(), '.easyCode')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'config.db')

  db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_configs (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      provider   TEXT NOT NULL,
      api_key    TEXT NOT NULL,
      base_url   TEXT NOT NULL,
      model      TEXT NOT NULL,
      is_active  INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS creations (
      id         TEXT PRIMARY KEY,
      version    TEXT NOT NULL,
      title      TEXT NOT NULL,
      content    TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_creations_version ON creations(version);
    CREATE INDEX IF NOT EXISTS idx_creations_updated ON creations(updated_at DESC);
    CREATE TABLE IF NOT EXISTS projects (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      path         TEXT NOT NULL,
      source       TEXT NOT NULL,
      git_url      TEXT,
      created_at   INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
    CREATE TABLE IF NOT EXISTS roles (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      title      TEXT NOT NULL DEFAULT '',
      duty       TEXT NOT NULL DEFAULT '',
      prompt     TEXT NOT NULL DEFAULT '',
      builtin    INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id             TEXT PRIMARY KEY,
      creation_id    TEXT NOT NULL,
      role_id        TEXT NOT NULL DEFAULT '',
      role_name      TEXT NOT NULL DEFAULT '',
      branch         TEXT NOT NULL DEFAULT '',
      status         TEXT NOT NULL,
      started_at     INTEGER NOT NULL,
      ended_at       INTEGER,
      changed_files  TEXT NOT NULL DEFAULT '[]',
      change_summary TEXT NOT NULL DEFAULT '',
      head_before    TEXT NOT NULL DEFAULT '',
      result_text    TEXT NOT NULL DEFAULT '',
      log            TEXT NOT NULL DEFAULT '[]',
      error          TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_runs_creation ON runs(creation_id, started_at DESC);
  `)
  migrate()
}

/** v0.1.1：对齐 PI-Desktop provider record，补 vendor_key / api_style / enabled 三列 */
function migrate(): void {
  const d = getDb()
  const cols = (d.prepare('PRAGMA table_info(ai_configs)').all() as unknown as { name: string }[]).map(
    (c) => c.name
  )
  if (!cols.includes('vendor_key')) {
    d.exec("ALTER TABLE ai_configs ADD COLUMN vendor_key TEXT NOT NULL DEFAULT ''")
    // 老数据的 provider 列存的就是预设 id，直接回填为 vendorKey
    d.exec('UPDATE ai_configs SET vendor_key = provider')
  }
  if (!cols.includes('api_style')) {
    d.exec("ALTER TABLE ai_configs ADD COLUMN api_style TEXT NOT NULL DEFAULT 'auto'")
  }
  if (!cols.includes('enabled')) {
    d.exec('ALTER TABLE ai_configs ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1')
  }

  // v0.4.0：创作关联项目与 git 分支。三列均可空，
  // 老数据保持「仅存库、不落文件」的原有行为。
  const ccols = (
    d.prepare('PRAGMA table_info(creations)').all() as unknown as { name: string }[]
  ).map((c) => c.name)
  if (!ccols.includes('project_id')) {
    d.exec('ALTER TABLE creations ADD COLUMN project_id TEXT')
  }
  if (!ccols.includes('file_path')) {
    d.exec('ALTER TABLE creations ADD COLUMN file_path TEXT')
  }
  if (!ccols.includes('branch')) {
    d.exec('ALTER TABLE creations ADD COLUMN branch TEXT')
  }
  // v0.5.0：创作默认绑定的编排角色
  if (!ccols.includes('role_id')) {
    d.exec('ALTER TABLE creations ADD COLUMN role_id TEXT')
  }
}

function getDb(): DatabaseSync {
  if (!db) throw new Error('数据库未初始化')
  return db
}

export function listConfigs(): AIConfig[] {
  const rows = getDb()
    .prepare('SELECT * FROM ai_configs ORDER BY created_at ASC')
    .all() as unknown as ConfigRow[]
  return rows.map(rowToConfig)
}

export function getActiveConfig(): AIConfig | null {
  const row = getDb()
    .prepare('SELECT * FROM ai_configs WHERE is_active = 1 LIMIT 1')
    .get() as unknown as ConfigRow | undefined
  return row ? rowToConfig(row) : null
}

/** 新增或更新配置；若是库里第一条配置则自动设为激活 */
export function saveConfig(input: AIConfigInput): AIConfig {
  const d = getDb()
  const now = Date.now()

  if (input.id) {
    d.prepare(
      `UPDATE ai_configs
         SET name = ?, provider = ?, vendor_key = ?, api_style = ?, api_key = ?,
             base_url = ?, model = ?, enabled = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      input.name,
      input.provider,
      input.vendorKey,
      input.apiStyle,
      input.apiKey,
      input.baseUrl,
      input.model,
      input.enabled ? 1 : 0,
      now,
      input.id
    )
    const row = d.prepare('SELECT * FROM ai_configs WHERE id = ?').get(input.id) as unknown as ConfigRow
    return rowToConfig(row)
  }

  const id = crypto.randomUUID()
  const countRow = d.prepare('SELECT COUNT(*) AS n FROM ai_configs').get() as unknown as { n: number }
  const isActive = Number(countRow.n) === 0 ? 1 : 0
  d.prepare(
    `INSERT INTO ai_configs
       (id, name, provider, vendor_key, api_style, api_key, base_url, model, enabled, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.provider,
    input.vendorKey,
    input.apiStyle,
    input.apiKey,
    input.baseUrl,
    input.model,
    input.enabled ? 1 : 0,
    isActive,
    now,
    now
  )

  const row = d.prepare('SELECT * FROM ai_configs WHERE id = ?').get(id) as unknown as ConfigRow
  return rowToConfig(row)
}

export function deleteConfig(id: string): void {
  const d = getDb()
  const row = d.prepare('SELECT * FROM ai_configs WHERE id = ?').get(id) as unknown as
    | ConfigRow
    | undefined
  if (!row) return
  d.prepare('DELETE FROM ai_configs WHERE id = ?').run(id)
  // 删掉的是激活配置时，把激活位顺移给最早的一条
  if (row.is_active === 1) {
    d.prepare(
      `UPDATE ai_configs SET is_active = 1
       WHERE id = (SELECT id FROM ai_configs ORDER BY created_at ASC LIMIT 1)`
    ).run()
  }
}

export function setActiveConfig(id: string): void {
  const d = getDb()
  d.exec('BEGIN')
  try {
    d.prepare('UPDATE ai_configs SET is_active = 0').run()
    d.prepare('UPDATE ai_configs SET is_active = 1 WHERE id = ?').run(id)
    d.exec('COMMIT')
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }
}

// ===================== 创作（creations） =====================

interface CreationRow {
  id: string
  version: string
  title: string
  content: string
  project_id: string | null
  file_path: string | null
  branch: string | null
  role_id: string | null
  created_at: number
  updated_at: number
}

function rowToCreation(row: CreationRow): Creation {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    content: row.content,
    // 老库的这三列可能不存在（迁移前写入的行），统一兜成 null
    projectId: row.project_id ?? null,
    filePath: row.file_path ?? null,
    branch: row.branch ?? null,
    roleId: row.role_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** 全部创作，最近修改的在前 */
export function listCreations(): Creation[] {
  const rows = getDb()
    .prepare('SELECT * FROM creations ORDER BY updated_at DESC')
    .all() as unknown as CreationRow[]
  return rows.map(rowToCreation)
}

export function getCreation(id: string): Creation | null {
  const row = getDb().prepare('SELECT * FROM creations WHERE id = ?').get(id) as unknown as
    | CreationRow
    | undefined
  return row ? rowToCreation(row) : null
}

/** 新建创作，正文初始为空 */
export function createCreation(input: CreationInput): Creation {
  const d = getDb()
  const now = Date.now()
  const id = crypto.randomUUID()
  d.prepare(
    `INSERT INTO creations (id, version, title, content, project_id, file_path, branch, created_at, updated_at)
     VALUES (?, ?, ?, '', ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.version,
    input.title,
    input.projectId ?? null,
    input.filePath ?? null,
    input.branch ?? null,
    now,
    now
  )
  const row = d.prepare('SELECT * FROM creations WHERE id = ?').get(id) as unknown as CreationRow
  return rowToCreation(row)
}

/** 把文档的落盘信息写回（新建时先建库记录、再写文件，最后补这两项） */
export function setCreationFile(id: string, filePath: string, branch: string | null): void {
  getDb()
    .prepare('UPDATE creations SET file_path = ?, branch = ?, updated_at = ? WHERE id = ?')
    .run(filePath, branch, Date.now(), id)
}

/**
 * 局部更新：只改传了的字段，未提供的保持原值。
 * 传入的值为 undefined 或与当前值无差异时，不写库（省掉无谓的 updated_at 抖动）。
 */
export function updateCreation(id: string, patch: CreationUpdate): Creation {
  const d = getDb()
  const current = getCreation(id)
  if (!current) throw new Error(`创作不存在：${id}`)

  const nextTitle = patch.title === undefined ? current.title : patch.title
  const nextContent = patch.content === undefined ? current.content : patch.content

  const changed = nextTitle !== current.title || nextContent !== current.content
  if (!changed) return current

  d.prepare('UPDATE creations SET title = ?, content = ?, updated_at = ? WHERE id = ?').run(
    nextTitle,
    nextContent,
    Date.now(),
    id
  )
  const row = d.prepare('SELECT * FROM creations WHERE id = ?').get(id) as unknown as CreationRow
  return rowToCreation(row)
}

export function deleteCreation(id: string): void {
  getDb().prepare('DELETE FROM creations WHERE id = ?').run(id)
}

/** 已用过的版本号（去重），按最早使用时间排序，供「新增创作」下拉选择 */
export function listCreationVersions(): string[] {
  const rows = getDb()
    .prepare('SELECT version, MIN(created_at) AS first_at FROM creations GROUP BY version ORDER BY first_at ASC')
    .all() as unknown as { version: string; first_at: number }[]
  return rows.map((r) => r.version)
}

// ===================== 项目（projects） =====================

interface ProjectRow {
  id: string
  name: string
  path: string
  source: string
  git_url: string | null
  created_at: number
  last_used_at: number
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    source: row.source === 'git' ? 'git' : 'local',
    gitUrl: row.git_url ?? null,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at
  }
}

/** 全部项目，最近使用的在前 */
export function listProjects(): Project[] {
  const rows = getDb()
    .prepare('SELECT * FROM projects ORDER BY last_used_at DESC')
    .all() as unknown as ProjectRow[]
  return rows.map(rowToProject)
}

export function getProject(id: string): Project | null {
  const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as
    | ProjectRow
    | undefined
  return row ? rowToProject(row) : null
}

/**
 * 登记项目。同一路径已存在则直接复用并刷新 last_used_at，
 * 不会重复插入（依赖 path 上的唯一索引）。
 */
export function upsertProject(input: {
  name: string
  path: string
  source: 'git' | 'local'
  gitUrl?: string | null
}): Project {
  const d = getDb()
  const existing = d.prepare('SELECT * FROM projects WHERE path = ?').get(input.path) as unknown as
    | ProjectRow
    | undefined
  const now = Date.now()

  if (existing) {
    d.prepare('UPDATE projects SET last_used_at = ?, name = ? WHERE id = ?').run(
      now,
      input.name,
      existing.id
    )
    const row = d.prepare('SELECT * FROM projects WHERE id = ?').get(existing.id) as unknown as ProjectRow
    return rowToProject(row)
  }

  const id = crypto.randomUUID()
  d.prepare(
    `INSERT INTO projects (id, name, path, source, git_url, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.name, input.path, input.source, input.gitUrl ?? null, now, now)
  const row = d.prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as ProjectRow
  return rowToProject(row)
}

export function touchProject(id: string): void {
  getDb().prepare('UPDATE projects SET last_used_at = ? WHERE id = ?').run(Date.now(), id)
}

/** 移除项目登记（不动磁盘上的代码） */
export function deleteProject(id: string): void {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id)
}

// ===================== 编排角色（roles） =====================

interface RoleRow {
  id: string
  name: string
  title: string
  duty: string
  prompt: string
  builtin: number
  created_at: number
  updated_at: number
}

function rowToRole(row: RoleRow): Role {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    duty: row.duty,
    prompt: row.prompt,
    builtin: row.builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * 内置角色。首次运行（roles 表为空）时写入。
 *
 * 「代码审查员」刻意写成只读：它的 prompt 要求只指出问题、不改代码，
 * 配合执行时的工具白名单，使其成为安全的「先看看」入口。
 */
const BUILTIN_ROLES: Omit<Role, 'id' | 'builtin' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: '前端工程师',
    title: '高级前端开发',
    duty: '按需求实现界面与交互，遵循项目现有的组件风格与样式约定。',
    prompt:
      '你擅长前端开发。优先复用项目已有的组件与样式约定，不要引入新的 UI 库或状态管理库。' +
      '注意交互细节（加载态、空状态、错误提示）与可访问性。'
  },
  {
    name: '后端工程师',
    title: '后端开发',
    duty: '按需求实现接口、数据模型与业务逻辑。',
    prompt:
      '你擅长后端开发。注意数据校验、错误处理与边界情况；接口设计遵循项目既有风格；' +
      '涉及数据结构变更时要考虑兼容与迁移。'
  },
  {
    name: '全栈工程师',
    title: '全栈开发',
    duty: '前后端一并实现，贯通从界面到数据的完整链路。',
    prompt:
      '你擅长全栈开发。先理清数据流（界面 → 接口 → 存储）再动手，保证前后端契约一致。'
  },
  {
    name: '需求分析师',
    title: '产品经理',
    duty: '把需求整理成可执行的开发任务清单，明确边界与验收标准。',
    prompt:
      '你是需求分析师。**不要修改任何代码文件**，只输出一份开发任务清单 markdown：' +
      '拆解为有序的任务项，每项写明要改哪些文件/模块、验收标准是什么、有哪些需要确认的假设。' +
      '把任务清单作为你的回复正文输出。'
  },
  {
    name: '代码审查员',
    title: '技术负责人',
    duty: '审查现有实现是否符合需求，指出问题与风险。',
    prompt:
      '你是代码审查者。**不要修改任何文件**，只阅读代码并输出审查意见：' +
      '需求是否已实现、有无遗漏、潜在缺陷、边界与异常处理、可维护性问题。' +
      '按严重程度排序，指出具体文件与位置，并给出修改建议。'
  }
]

/** 首次运行时植入内置角色；已有数据则不动 */
function seedBuiltinRoles(): void {
  const d = getDb()
  const n = (d.prepare('SELECT COUNT(*) AS n FROM roles').get() as unknown as { n: number }).n
  if (Number(n) > 0) return
  const now = Date.now()
  const stmt = d.prepare(
    `INSERT INTO roles (id, name, title, duty, prompt, builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  )
  for (const r of BUILTIN_ROLES) {
    stmt.run(crypto.randomUUID(), r.name, r.title, r.duty, r.prompt, now, now)
  }
}

export function listRoles(): Role[] {
  seedBuiltinRoles()
  const rows = getDb()
    .prepare('SELECT * FROM roles ORDER BY builtin DESC, created_at ASC')
    .all() as unknown as RoleRow[]
  return rows.map(rowToRole)
}

export function getRole(id: string): Role | null {
  const row = getDb().prepare('SELECT * FROM roles WHERE id = ?').get(id) as unknown as
    | RoleRow
    | undefined
  return row ? rowToRole(row) : null
}

export function saveRole(input: RoleInput): Role {
  const d = getDb()
  const now = Date.now()
  if (input.id) {
    d.prepare(
      'UPDATE roles SET name = ?, title = ?, duty = ?, prompt = ?, updated_at = ? WHERE id = ?'
    ).run(input.name, input.title, input.duty, input.prompt, now, input.id)
    const row = d.prepare('SELECT * FROM roles WHERE id = ?').get(input.id) as unknown as RoleRow
    return rowToRole(row)
  }
  const id = crypto.randomUUID()
  d.prepare(
    `INSERT INTO roles (id, name, title, duty, prompt, builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(id, input.name, input.title, input.duty, input.prompt, now, now)
  const row = d.prepare('SELECT * FROM roles WHERE id = ?').get(id) as unknown as RoleRow
  return rowToRole(row)
}

/** 删除角色。内置角色不允许删除（保护默认角色不被误删） */
export function deleteRole(id: string): { ok: boolean; error?: string } {
  const role = getRole(id)
  if (!role) return { ok: true }
  if (role.builtin) return { ok: false, error: '内置角色不可删除，可「复制为新角色」后再修改。' }
  getDb().prepare('DELETE FROM roles WHERE id = ?').run(id)
  return { ok: true }
}

/** 复制一个角色为新角色（用于在内置角色基础上改） */
export function duplicateRole(id: string): Role | null {
  const r = getRole(id)
  if (!r) return null
  return saveRole({
    name: `${r.name} 副本`,
    title: r.title,
    duty: r.duty,
    prompt: r.prompt
  })
}

// ===================== 执行记录（runs） =====================

interface RunRow {
  id: string
  creation_id: string
  role_id: string
  role_name: string
  branch: string
  status: string
  started_at: number
  ended_at: number | null
  changed_files: string
  change_summary: string
  head_before: string
  result_text: string
  log: string
  error: string | null
}

function rowToRun(row: RunRow): RunRecord {
  const parseArr = <T,>(s: string, fallback: T): T => {
    try {
      return JSON.parse(s) as T
    } catch {
      return fallback
    }
  }
  return {
    id: row.id,
    creationId: row.creation_id,
    roleId: row.role_id,
    roleName: row.role_name,
    branch: row.branch,
    status: row.status as RunRecord['status'],
    startedAt: row.started_at,
    endedAt: row.ended_at,
    changedFiles: parseArr<string[]>(row.changed_files, []),
    changeSummary: row.change_summary,
    headBefore: row.head_before,
    resultText: row.result_text,
    log: parseArr<RunLogEntry[]>(row.log, []),
    error: row.error ?? undefined
  }
}

export function listRuns(creationId: string): RunRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM runs WHERE creation_id = ? ORDER BY started_at DESC')
    .all(creationId) as unknown as RunRow[]
  return rows.map(rowToRun)
}

export function saveRun(rec: Omit<RunRecord, 'id'> & { id?: string }): RunRecord {
  const d = getDb()
  const id = rec.id ?? crypto.randomUUID()
  d.prepare(
    `INSERT INTO runs (id, creation_id, role_id, role_name, branch, status, started_at, ended_at,
                       changed_files, change_summary, head_before, result_text, log, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    rec.creationId,
    rec.roleId,
    rec.roleName,
    rec.branch,
    rec.status,
    rec.startedAt,
    rec.endedAt,
    JSON.stringify(rec.changedFiles ?? []),
    rec.changeSummary ?? '',
    rec.headBefore ?? '',
    rec.resultText ?? '',
    JSON.stringify(rec.log ?? []),
    rec.error ?? null
  )
  const row = d.prepare('SELECT * FROM runs WHERE id = ?').get(id) as unknown as RunRow
  return rowToRun(row)
}

export function deleteRun(id: string): void {
  getDb().prepare('DELETE FROM runs WHERE id = ?').run(id)
}

/** 设置创作默认绑定的角色 */
export function setCreationRole(creationId: string, roleId: string | null): void {
  getDb()
    .prepare('UPDATE creations SET role_id = ?, updated_at = ? WHERE id = ?')
    .run(roleId, Date.now(), creationId)
}
