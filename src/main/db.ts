import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import type { AIConfig, AIConfigInput } from '../shared/types'
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
