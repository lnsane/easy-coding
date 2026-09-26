import { useEffect } from 'react'
import { useConfigStore } from './store'
import SetupPage from './pages/SetupPage'
import MainPage from './pages/MainPage'

export default function App(): React.JSX.Element {
  const { loaded, activeConfig, load } = useConfigStore()

  useEffect(() => {
    void load()
  }, [load])

  if (!loaded) {
    return (
      <div className="flex h-screen items-center justify-center text-zinc-500">
        正在加载…
      </div>
    )
  }

  // 首次启动：没有任何激活配置 → 进入 AI 配置引导
  if (!activeConfig) {
    return <SetupPage />
  }

  return <MainPage />
}
