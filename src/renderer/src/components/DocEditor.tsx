import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { redo as cmRedo, undo as cmUndo } from '@codemirror/commands'
import { oneDark } from '@codemirror/theme-one-dark'
import type { Creation } from '../../../shared/types'
import { useConfigStore } from '../store'
import { renderMarkdown } from '../lib/markdown-render'
import MarkdownToolbar from './MarkdownToolbar'
import PolishDialog from './PolishDialog'
import { applyAction, diffRange } from '../lib/markdown-actions'
import type { Action } from '../lib/markdown-actions'

interface Props {
  creation: Creation
  onBack: () => void
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const AUTOSAVE_DELAY = 800

/** 文档编辑窗口：左侧 CodeMirror 源码，右侧实时预览 */
export default function DocEditor({ creation, onBack }: Props): React.JSX.Element {
  const updateCreation = useConfigStore((s) => s.updateCreation)
  const projects = useConfigStore((s) => s.projects)
  const editorRef = useRef<ReactCodeMirrorRef>(null)

  /** 关联的项目（若有），润色时作为 Claude Code 的工作目录 */
  const project = creation.projectId
    ? (projects.find((p) => p.id === creation.projectId) ?? null)
    : null

  const [content, setContent] = useState(creation.content)
  const [title, setTitle] = useState(creation.title)
  const [saveState, setSaveState] = useState<SaveState>('idle')

  /**
   * 挂起的写入。用 ref 保存「待写内容」而不是把定时器闭包在 state 上，
   * 这样卸载时的 flush 能拿到最新的值。
   */
  const pendingRef = useRef<{ title: string; content: string } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 写入序号：只认最后一次的结果，避免旧请求回来覆盖新状态 */
  const seqRef = useRef(0)

  const flush = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null

    const seq = ++seqRef.current
    setSaveState('saving')
    try {
      await updateCreation(creation.id, pending)
      // 关联项目时同步写项目 doc/ 下的文件，让文件始终跟得上
      if (project && creation.filePath) {
        try {
          await window.api.writeFileAt(project.path, creation.filePath, pending.content)
        } catch (err) {
          // 文件写入失败不应让整次保存失败：DB 已是权威副本，
          // 但要让用户知道文件没同步上
          setSaveState('error')
          setPolishError(`已保存到应用数据库，但同步写文件失败：${String(err)}`)
          return
        }
      }
      if (seq === seqRef.current) setSaveState('saved')
    } catch {
      if (seq === seqRef.current) setSaveState('error')
    }
  }, [creation.id, creation.filePath, updateCreation, project])

  const schedule = useCallback(
    (next: { title: string; content: string }): void => {
      pendingRef.current = next
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void flush(), AUTOSAVE_DELAY)
    },
    [flush]
  )

  /** 回到列表：必须先等最后一次编辑落库，否则防抖窗口内的改动会丢 */
  const goBack = useCallback(async (): Promise<void> => {
    await flush()
    onBack()
  }, [flush, onBack])

  // 卸载 / 切换文档时把最后一次输入落盘，否则防抖窗口内的改动会丢
  useEffect(() => {
    return () => {
      void flush()
    }
  }, [flush])

  /**
   * 只在「切换到另一份文档」时重置本地状态。
   *
   * 这里必须用 docIdRef 显式判断，**不能**靠依赖 creation.content 来判断——
   * 自动保存成功后 store 会刷新列表，creation.content 随之变化，若据此重跑本
   * effect 就会把用户正在输入的内容顶掉、并把 pending 清空（真实丢内容路径）：
   *
   *   输入 abc → 保存开始 → 继续输入 abcd → abc 保存完成 → 列表刷新
   *   → effect 重跑 → 编辑器被回滚成 abc，pending 的 abcd 被丢弃
   *
   * 挂载期间本组件对当前文档才是权威数据源，列表刷新只服务于列表视图。
   */
  const docIdRef = useRef(creation.id)
  useEffect(() => {
    if (docIdRef.current === creation.id) return
    docIdRef.current = creation.id
    setContent(creation.content)
    setTitle(creation.title)
    setSaveState('idle')
    pendingRef.current = null
  }, [creation.id, creation.content, creation.title])

  const view = (): EditorView | null => editorRef.current?.view ?? null

  /**
   * 关联了项目、且库里 content 为空时，从项目文件导入初始内容。
   *
   * 覆盖这个场景：切到已存在的分支（比如 v1.0），该分支上本来就有这份文档，
   * 此时应把文件内容读进来继续编辑，而不是给用户一个空白编辑器。
   *
   * 两个必须注意的点：
   * - **按文档 id 记忆**，不能用布尔量：否则打开第一份文档后它一直是 true，
   *   切到第二份文档就再也不会导入。
   * - **等 project / filePath 就绪后再记忆**：项目列表是异步加载的，
   *   若在数据到位前就把状态标记成「已导入」，就再也不会重试。
   */
  const importedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!project || !creation.filePath) return
    if (importedForRef.current === creation.id) return
    importedForRef.current = creation.id
    if (creation.content.trim()) return

    const filePath = creation.filePath
    const projectPath = project.path
    void (async () => {
      try {
        const text = await window.api.readFileAt(projectPath, filePath)
        if (typeof text !== 'string' || !text.trim()) return
        const v = view()
        if (v) {
          v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
        }
        setContent(text)
        // 导入的内容也要落库，否则下次打开又变空
        pendingRef.current = { title, content: text }
        void flush()
      } catch {
        // 读不到就按空文档处理，不打扰用户
      }
    })()
  }, [project, creation.filePath, creation.content, title, flush])

  /** 把工具栏动作作用到编辑器：读出选区 → 纯函数变换 → 按最小差异写回 */
  const onAction = useCallback((action: Action): void => {
    const v = view()
    if (!v) return
    const state = v.state
    const before = state.doc.toString()
    const r = applyAction(
      action,
      before,
      state.selection.main.from,
      state.selection.main.to
    )

    v.dispatch({
      // 只替换变化的那一段，而不是整篇重写：保证撤销粒度正常、光标映射不乱
      changes: diffRange(before, r.text),
      selection: { anchor: r.selectionStart, head: r.selectionEnd }
    })
    v.focus()
  }, [])

  const undo = useCallback((): void => {
    const v = view()
    if (!v) return
    cmUndo(v)
    v.focus()
  }, [])

  const redo = useCallback((): void => {
    const v = view()
    if (!v) return
    cmRedo(v)
    v.focus()
  }, [])

  // 进入文档后自动聚焦编辑器，省掉用户再点一下
  useEffect(() => {
    const t = setTimeout(() => view()?.focus(), 0)
    return () => clearTimeout(t)
  }, [creation.id])

  // ------------------------- 润色 -------------------------

  const [polishing, setPolishing] = useState(false)
  const [polishError, setPolishError] = useState('')
  /** 待确认的润色结果；非 null 时弹出确认框 */
  const [pending, setPending] = useState<{ original: string; polished: string } | null>(null)

  const runPolish = useCallback(async (): Promise<void> => {
    const v = view()
    const source = v ? v.state.doc.toString() : content
    if (!source.trim()) {
      setPolishError('文档内容为空，无需润色。')
      return
    }
    setPolishError('')
    setPolishing(true)
    try {
      const r = await window.api.polish(source, project?.path ?? null)
      if (!r.ok) {
        setPolishError(r.error ?? '润色失败')
        return
      }
      // 结果先不落盘，交给用户确认或撤回
      setPending({ original: source, polished: r.text })
    } catch (err) {
      setPolishError(String(err))
    } finally {
      setPolishing(false)
    }
  }, [content, project?.path])

  /** 用户确认：用润色稿替换编辑器内容，并立即落盘 */
  const applyPolish = useCallback(
    (result: string): void => {
      const v = view()
      const before = v ? v.state.doc.toString() : content
      if (v) {
        v.dispatch({ changes: diffRange(before, result) })
        v.focus()
      }
      setContent(result)
      setPending(null)
      pendingRef.current = { title, content: result }
      void flush()
    },
    [content, title, flush]
  )

  /** 用户撤回：什么都不改 */
  const rejectPolish = useCallback((): void => {
    setPending(null)
    view()?.focus()
  }, [])

  const html = useMemo(() => renderMarkdown(content), [content])

  /**
   * 从**编辑器**当前内容取值，而不是闭包里的 content。
   *
   * 标题输入框的 onChange 若用闭包里的 content，会把「点进标题框之前」
   * 的旧正文写回库，把用户刚打的字覆盖掉。以编辑器 doc 为准即可避免。
   */
  const liveContent = (): string => view()?.state.doc.toString() ?? content

  const saveLabel =
    saveState === 'saving'
      ? '保存中…'
      : saveState === 'error'
        ? '保存失败'
        : saveState === 'saved'
          ? '已保存'
          : '未修改'

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏：返回 + 标题 + 保存状态 */}
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-zinc-800 px-3">
        <button
          type="button"
          onClick={() => void goBack()}
          className="rounded-md px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          title="返回列表"
        >
          ← 返回
        </button>

        <button
          type="button"
          onClick={() => void runPolish()}
          disabled={polishing}
          title="调用 Claude Code 对当前文档做语言润色"
          className="flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:border-indigo-500 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {polishing ? (
            <>
              <span className="inline-block h-3 w-3 animate-spin rounded-full border border-zinc-500 border-t-transparent" />
              润色中…
            </>
          ) : (
            <>✨ 润色</>
          )}
        </button>
        <span className="rounded bg-indigo-500/15 px-2 py-0.5 text-[11px] text-indigo-300">
          v{creation.version}
        </span>

        {/* 关联项目与分支：让用户随时能确认文档写到哪里去了 */}
        {project && (
          <span
            className="flex max-w-[38%] items-center gap-1.5 rounded border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400"
            title={`${project.path}${creation.filePath ? `\n${creation.filePath}` : ''}`}
          >
            <span className="truncate">{project.name}</span>
            {creation.branch && (
              <span className="shrink-0 rounded bg-zinc-800 px-1 text-[10px] text-emerald-300">
                {creation.branch}
              </span>
            )}
          </span>
        )}
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            schedule({ title: e.target.value, content: liveContent() })
          }}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-sm text-zinc-100 outline-none transition hover:border-zinc-800 focus:border-indigo-500"
        />
        <span
          className={`shrink-0 text-[11px] ${
            saveState === 'error' ? 'text-red-400' : 'text-zinc-500'
          }`}
        >
          {saveLabel}
        </span>
      </div>

      <MarkdownToolbar onAction={onAction} onUndo={undo} onRedo={redo} />

      {polishError && (
        <div className="flex shrink-0 items-start gap-2 border-b border-red-900/50 bg-red-950/40 px-3 py-2">
          <span className="text-xs text-red-300">{polishError}</span>
          <button
            type="button"
            onClick={() => setPolishError('')}
            className="ml-auto shrink-0 text-xs text-red-400/70 hover:text-red-300"
          >
            关闭
          </button>
        </div>
      )}

      {/* 主体：左编辑器 / 右预览 */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-hidden border-r border-zinc-800">
          <CodeMirror
            ref={editorRef}
            value={content}
            height="100%"
            // 必须显式给暗色主题：@uiw/react-codemirror 的 theme 默认值是 'light'，
            // 会启用 CodeMirror 的浅色基础样式（白底、黑色光标），而浅色主题并不
            // 设置文字颜色，文字于是继承 body 的近白色 → 白底白字。
            theme={oneDark}
            extensions={[markdown({ base: markdownLanguage }), EditorView.lineWrapping]}
            onChange={(val) => {
              setContent(val)
              schedule({ title, content: val })
            }}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLine: true,
              foldGutter: false,
              autocompletion: false
            }}
            className="h-full text-sm"
          />
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div
            className="markdown-body px-6 py-4 text-sm text-zinc-200"
            // 内容已过 DOMPurify（见 lib/markdown-render.ts）
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {!content.trim() && (
            <p className="px-6 py-4 text-xs text-zinc-600">右侧将实时显示 markdown 渲染结果</p>
          )}
        </div>
      </div>

      {pending && (
        <PolishDialog
          original={pending.original}
          polished={pending.polished}
          onAccept={applyPolish}
          onReject={rejectPolish}
        />
      )}
    </div>
  )
}
