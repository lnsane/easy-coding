import { useEffect, useState } from 'react'
import { useConfigStore } from '../store'
import ConfigManager from '../components/ConfigManager'
import CreationList from '../components/CreationList'
import CreateDialog from '../components/CreateDialog'
import DocEditor from '../components/DocEditor'

type TabKey = 'collab' | 'orchestration'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'collab', label: '协作' },
  { key: 'orchestration', label: '编排' }
]

export default function MainPage(): React.JSX.Element {
  const activeConfig = useConfigStore((s) => s.activeConfig)
  const creations = useConfigStore((s) => s.creations)
  const versions = useConfigStore((s) => s.versions)
  const loadCreations = useConfigStore((s) => s.loadCreations)
  const createCreation = useConfigStore((s) => s.createCreation)
  const prepareProject = useConfigStore((s) => s.prepareProject)
  const loadProjects = useConfigStore((s) => s.loadProjects)

  const [tab, setTab] = useState<TabKey>('collab')
  const [showManager, setShowManager] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  /** 新增创作流程中的错误（准备项目/写文件失败），显示在弹窗内 */
  const [createError, setCreateError] = useState('')
  /** 当前打开的创作 id；null = 列表态 */
  const [activeCreationId, setActiveCreationId] = useState<string | null>(null)

  useEffect(() => {
    void loadCreations()
    // 项目列表供编辑器显示「项目 · 分支」，启动时加载一次
    void loadProjects()
  }, [loadCreations, loadProjects])

  const activeCreation = creations.find((c) => c.id === activeCreationId) ?? null

  return (
    <div className="flex h-screen flex-col">
      {/* 顶栏：左侧 tab，右侧当前配置 */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
        <div className="flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative rounded-md px-4 py-1.5 text-sm transition ${
                tab === t.key
                  ? 'bg-zinc-800 font-medium text-zinc-100'
                  : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
              }`}
            >
              {t.label}
              {tab === t.key && (
                <span className="absolute inset-x-3 -bottom-[9px] h-0.5 rounded-full bg-indigo-500" />
              )}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowManager(true)}
          className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
          title="管理 AI 配置"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {activeConfig ? `${activeConfig.name} · ${activeConfig.model}` : '未配置 AI'}
        </button>
      </header>

      {/* 内容区 */}
      <main className="min-h-0 flex-1">
        {tab === 'collab' ? (
          activeCreation ? (
            <DocEditor creation={activeCreation} onBack={() => setActiveCreationId(null)} />
          ) : (
            <CreationList onOpen={setActiveCreationId} onNew={() => setShowCreate(true)} />
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-2xl">
              🧩
            </div>
            <h2 className="text-lg font-medium text-zinc-200">编排</h2>
            <p className="max-w-sm text-sm text-zinc-500">多 Agent / 多步骤任务编排画布，敬请期待。</p>
          </div>
        )}
      </main>

      {showManager && <ConfigManager onClose={() => setShowManager(false)} />}

      {showCreate && (
        <CreateDialog
          versions={versions}
          onCancel={() => setShowCreate(false)}
          onConfirm={async ({ projectId, gitUrl, localPath, version, title, onProgress }) => {
            // 1) 准备项目：clone / 校验路径 + 确保 git 分支
            onProgress('正在准备项目（clone 或校验目录）…')
            const prepared = await prepareProject({ projectId, gitUrl, localPath, version })
            if (!prepared.ok || !prepared.project) {
              setCreateError(prepared.message)
              return
            }
            const project = prepared.project

            try {
              // 2) 先建库记录（此时还没有文件路径）
              onProgress('正在创建文档…')
              const created = await createCreation({
                version,
                title,
                projectId: project.id,
                branch: prepared.branch ?? null
              })

              // 3) 在项目 doc/ 下落盘（标题已存在同名文件时自动加序号）
              onProgress('正在写入 doc/ 目录…')
              const rel = await window.api.writeDocFile(project.path, title, '')
              await window.api.setCreationFile(created.id, rel, prepared.branch ?? null)

              // 4) 刷新列表并进入编辑器
              await loadCreations()
              setShowCreate(false)
              setCreateError('')
              setActiveCreationId(created.id)
            } catch (err) {
              setCreateError(`创建文档失败：${String(err)}`)
            }
          }}
          error={createError}
          onErrorClear={() => setCreateError('')}
        />
      )}
    </div>
  )
}
