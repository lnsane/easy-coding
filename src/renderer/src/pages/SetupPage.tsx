import ConfigForm from '../components/ConfigForm'
import { useConfigStore } from '../store'

/** 首次启动的 AI 配置引导页：保存第一条配置（自动设为激活）后进入主页面 */
export default function SetupPage(): React.JSX.Element {
  const load = useConfigStore((s) => s.load)

  return (
    <div className="flex h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">欢迎使用 easyCode</h1>
          <p className="mt-1 text-sm text-zinc-400">
            先配置一个 AI 服务，配置会保存在本机 ~/.easyCode/config.db
          </p>
        </div>
        <ConfigForm submitLabel="保存并进入" onSaved={() => void load()} />
      </div>
    </div>
  )
}
