import { useState } from 'react'
import { useConfigStore } from '../store'
import ConfigManager from '../components/ConfigManager'

type TabKey = 'collab' | 'orchestration'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'collab', label: '协作' },
  { key: 'orchestration', label: '编排' }
]

export default function MainPage(): React.JSX.Element {
  const activeConfig = useConfigStore((s) => s.activeConfig)
  const [tab, setTab] = useState<TabKey>('collab')
  const [showManager, setShowManager] = useState(false)

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
      <main className="flex flex-1 items-center justify-center">
        {tab === 'collab' ? (
          <Placeholder
            title="协作"
            desc="与 AI 结对编程的对话工作区，敬请期待。"
          />
        ) : (
          <Placeholder
            title="编排"
            desc="多 Agent / 多步骤任务编排画布，敬请期待。"
          />
        )}
      </main>

      {showManager && <ConfigManager onClose={() => setShowManager(false)} />}
    </div>
  )
}

function Placeholder({ title, desc }: { title: string; desc: string }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-2xl">
        {title === '协作' ? '🤝' : '🧩'}
      </div>
      <h2 className="text-lg font-medium text-zinc-200">{title}</h2>
      <p className="max-w-sm text-sm text-zinc-500">{desc}</p>
    </div>
  )
}
