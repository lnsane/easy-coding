import { useEffect } from 'react'
import { useConfigStore } from './store'
import MainPage from './pages/MainPage'

export default function App(): React.JSX.Element {
  const { loaded, load } = useConfigStore()

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

  // 直接进入主页面；尚未配置 AI 时，用右上角按钮打开配置管理
  return <MainPage />
}
