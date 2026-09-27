import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { redo as cmRedo, undo as cmUndo } from '@codemirror/commands'
import { oneDark } from '@codemirror/theme-one-dark'
import type { Creation, Role } from '../../../shared/types'
import { useConfigStore } from '../store'
import { renderMarkdown } from '../lib/markdown-render'
import MarkdownToolbar from './MarkdownToolbar'
import PolishDialog from './PolishDialog'
import RunProgress, { type PolishLogEntry } from './RunProgress'
import RunConfirmDialog from './RunConfirmDialog'
import PlanDialog from './PlanDialog'
import { buildRunSection } from '../../../shared/run-section'
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
  /** 当前这轮润色的标识，用于过滤日志 */
  const runIdRef = useRef('')

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
  /** 执行过程日志（实时从主进程推送过来） */
  const [polishLogs, setPolishLogs] = useState<PolishLogEntry[]>([])
  const [showProgress, setShowProgress] = useState(false)
  const [phase, setPhase] = useState('')

  // 订阅主进程推来的执行过程日志
  useEffect(() => {
    const off = window.api.onPolishLog((runId: string, entry: PolishLogEntry) => {
      if (runId !== runIdRef.current) return
      setPolishLogs((prev) => [...prev, entry])
    })
    return off
  }, [])

  const runPolish = useCallback(async (): Promise<void> => {
    const v = view()
    const source = v ? v.state.doc.toString() : content
    if (!source.trim()) {
      setPolishError('文档内容为空，无需润色。')
      return
    }
    setPolishError('')
    setPolishLogs([])
    setPhase('准备中…')
    setShowProgress(true)
    setPolishing(true)

    // 每次执行一个独立 runId，避免上一次的日志串到这一次
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    runIdRef.current = runId

    const cwd = project?.path ?? null
    const docRel = creation.filePath ?? null
    setPolishLogs([
      {
        kind: 'info',
        text: `开始润色：文档 ${source.length} 字符`,
        at: Date.now()
      },
      {
        kind: 'info',
        text: cwd
          ? `关联项目「${project?.name}」，将在该项目目录下执行`
          : '未关联项目，将在应用默认目录下执行（不读取项目上下文）',
        at: Date.now()
      }
    ])

    try {
      setPhase('执行中…')
      const r = await window.api.polish(runId, source, cwd, docRel)
      if (!r.ok) {
        setPolishError(r.error ?? '润色失败')
        setPhase('失败')
        return
      }

      // 关联项目时是「直写模式」：Claude Code 已把结果写回项目里的文件，
      // stdout 只有一句摘要。因此这里要**重新读回文件**拿真实结果，
      // 再把「改动前 vs 改动后」交给确认弹窗。
      const directWrite = Boolean(cwd && docRel)
      if (directWrite) {
        const onDisk = await window.api.readFileAt(cwd!, docRel!)
        if (typeof onDisk === 'string' && onDisk.trim() && onDisk !== source) {
          setPhase('已完成，请确认改动')
          setPending({ original: source, polished: onDisk })
        } else {
          // 文件与原文一致（或读不回来）：说明没有改动，不必弹确认框
          setPhase('已完成：文档无需修改')
        }
        return
      }

      setPhase('已完成，请确认改动')
      setPending({ original: source, polished: r.text })
    } catch (err) {
      setPolishError(String(err))
      setPhase('失败')
    } finally {
      setPolishing(false)
    }
  }, [content, project?.path, project?.name, creation.filePath])

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

  // ------------------------- 执行编排任务 -------------------------

  const roles = useConfigStore((s) => s.roles)
  const loadRoles = useConfigStore((s) => s.loadRoles)
  const setCreationRole = useConfigStore((s) => s.setCreationRole)
  const [orchestrating, setOrchestrating] = useState(false)
  const [showRunConfirm, setShowRunConfirm] = useState(false)
  const [orchestrateError, setOrchestrateError] = useState('')
  const [runLogs, setRunLogs] = useState<PolishLogEntry[]>([])
  const [runPhase, setRunPhase] = useState('')
  const [runSummary, setRunSummary] = useState('')
  const [showRunProgress, setShowRunProgress] = useState(false)
  /** 当前编排执行的标识，用于过滤日志与中止 */
  const orchRunIdRef = useRef('')
  /**
   * 与 runLogs 同步的 ref。
   * startOrchestrate 是 useCallback，闭包里的 runLogs 是旧的；
   * 落执行记录时必须读这个 ref，否则 log 恒为空或错位。
   */
  const orchLogsRef = useRef<PolishLogEntry[]>([])

  useEffect(() => {
    void loadRoles()
  }, [loadRoles])

  // 订阅编排执行日志
  useEffect(() => {
    const off = window.api.onOrchestrateLog((runId: string, entry: PolishLogEntry) => {
      if (runId !== orchRunIdRef.current) return
      setRunLogs((prev) => {
        const next = [...prev, entry]
        // 同时写进 ref：startOrchestrate 是 useCallback，其闭包里的 runLogs
        // 是「回调创建那一刻」的旧数组，执行期间累积的日志进不去，
        // 会导致落库的 log 恒为空或错位（实测确认）。ref 则始终是最新的。
        orchLogsRef.current = next
        return next
      })
    })
    return off
  }, [])

  const startOrchestrate = useCallback(
    async (role: Role): Promise<void> => {
      if (!project || !creation.filePath) {
        setOrchestrateError('需要先关联项目，并为文档生成 project 内的文件路径。')
        setShowRunConfirm(false)
        return
      }
      setShowRunConfirm(false)
      setOrchestrateError('')

      // 记住本次选用的角色，作为这份文档下次执行的默认值。
      // 这也把先前「只声明未调用」的 setCreationRole 链路接上了。
      if (creation.roleId !== role.id) {
        void setCreationRole(creation.id, role.id).catch(() => {
          // 记默认值失败不影响本次执行
        })
      }

      // 先把编辑器里的最新内容落盘——AI 要读的是磁盘上的最新需求，不能是旧文件
      await flush()

      const runId = `orch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      orchRunIdRef.current = runId
      setRunLogs([])
      orchLogsRef.current = []
      setRunSummary('')
      setRunPhase('准备中…')
      setShowRunProgress(true)
      setOrchestrating(true)

      try {
        setRunPhase('执行中…')
        const r = await window.api.orchestrate(runId, {
          projectPath: project.path,
          docRelPath: creation.filePath,
          version: creation.version,
          role: {
            id: role.id,
            name: role.name,
            title: role.title,
            duty: role.duty,
            prompt: role.prompt
          }
        })

        const meta = r.meta
        if (meta) {
          setRunSummary(
            `${meta.status === 'ok' ? '成功' : meta.status === 'cancelled' ? '已中止' : '失败'} · ${meta.changeSummary}`
          )
          // 把「执行记录」追加到文档（这也是需求文档里选定的结果去向）
          try {
            const section = buildRunSection(meta, creation.filePath)
            const v = view()
            const cur = v ? v.state.doc.toString() : content
            const next = cur.replace(/\s*$/, '') + '\n' + section
            if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: next } })
            setContent(next)
            pendingRef.current = { title, content: next }
            await flush()
          } catch {
            // 追加记录失败不影响执行结果本身
          }
          // 落执行记录到库
          try {
            await window.api.saveRun({
              creationId: creation.id,
              roleId: role.id,
              roleName: role.name,
              branch: meta.branch,
              status: meta.status,
              startedAt: meta.startedAt,
              endedAt: meta.endedAt,
              changedFiles: meta.changedFiles,
              changeSummary: meta.changeSummary,
              headBefore: meta.headBefore,
              resultText: meta.resultText,
              // 用 ref 取「执行期间累积的完整日志」，闭包里的 runLogs 是旧值
              log: orchLogsRef.current,
              error: meta.error
            })
          } catch {
            // 记录失败不影响主流程
          }
        }

        // 用户主动中止不是失败：orchestrate 在中止时也返回 ok:false，
        // 若一律弹红色错误横幅，会让人以为出错了。先判断中止，再判失败。
        if (r.meta?.status === 'cancelled') {
          setRunPhase('已中止')
        } else if (!r.ok) {
          setOrchestrateError(r.error ?? '执行未成功')
        } else {
          setRunPhase('已完成')
        }
      } catch (err) {
        setOrchestrateError(String(err))
        setRunPhase('失败')
      } finally {
        setOrchestrating(false)
      }
    },
    [project, creation.filePath, creation.version, creation.id, creation.roleId, content, title, flush, runLogs, setCreationRole]
  )

  /** 中止：通知主进程杀掉进程树 */
  const abortOrchestrate = useCallback((): void => {
    const id = orchRunIdRef.current
    if (id) void window.api.abortOrchestrate(id)
    setRunPhase('正在中止…')
  }, [])

  // ------------------------- 生成开发计划 -------------------------

  const createCreation = useConfigStore((s) => s.createCreation)
  const [showPlanDialog, setShowPlanDialog] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [planError, setPlanError] = useState('')
  const [planLogs, setPlanLogs] = useState<PolishLogEntry[]>([])
  const [planPhase, setPlanPhase] = useState('')
  const [showPlanProgress, setShowPlanProgress] = useState(false)
  const planRunIdRef = useRef('')

  useEffect(() => {
    const off = window.api.onPlanLog((runId: string, entry: PolishLogEntry) => {
      if (runId !== planRunIdRef.current) return
      setPlanLogs((prev) => [...prev, entry])
    })
    return off
  }, [])

  const startPlan = useCallback(
    async (planName: string): Promise<void> => {
      setShowPlanDialog(false)
      setPlanError('')

      // 先把编辑器里的最新内容落盘，AI 读到的是最新需求
      await flush()

      const v = view()
      const source = v ? v.state.doc.toString() : content
      if (!source.trim()) {
        setPlanError('需求文档内容为空，无法生成开发计划。')
        return
      }

      const runId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      planRunIdRef.current = runId
      setPlanLogs([])
      setPlanPhase('生成中…')
      setShowPlanProgress(true)
      setPlanning(true)

      try {
        const r = await window.api.generatePlan(
          runId,
          source,
          creation.title,
          project?.path ?? null
        )
        if (!r.ok || !r.text.trim()) {
          setPlanError(r.error ?? '生成失败')
          setPlanPhase('失败')
          return
        }

        // 落盘：关联项目时写入项目 doc/ 下并登记为新创作
        if (project) {
          setPlanPhase('正在写入文档…')
          const rel = await window.api.writeDocFile(project.path, planName, r.text)
          const created = await createCreation({
            version: creation.version,
            title: planName,
            projectId: project.id,
            branch: creation.branch
          })
          await window.api.setCreationFile(created.id, rel, creation.branch)
          setPlanPhase(`已生成：${rel}`)
        } else {
          // 未关联项目：不落盘，只把结果留在日志里提示用户
          setPlanPhase('已生成（未关联项目，未落盘）')
          setPlanError('当前文档未关联项目，计划已生成但未保存到文件。请先关联项目后重试。')
        }
      } catch (err) {
        setPlanError(String(err))
        setPlanPhase('失败')
      } finally {
        setPlanning(false)
      }
    },
    [content, creation.title, creation.version, creation.branch, flush, project, createCreation]
  )

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

        {/* 生成开发计划：依据本文档产出一份可执行的计划文档 */}
        <button
          type="button"
          onClick={() => setShowPlanDialog(true)}
          disabled={planning || polishing || orchestrating}
          title="依据当前需求文档生成一份开发计划（只读模式，不改任何文件）"
          className="flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:border-sky-500 hover:text-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {planning ? (
            <>
              <span className="inline-block h-3 w-3 animate-spin rounded-full border border-zinc-500 border-t-transparent" />
              生成中…
            </>
          ) : (
            <>📋 生成开发计划</>
          )}
        </button>

        {/* 执行编排任务：以本文档为需求说明，让 AI 在项目里写代码 */}
        <button
          type="button"
          onClick={() => setShowRunConfirm(true)}
          disabled={orchestrating || polishing || planning}
          title={
            project
              ? '以本文档为需求，让 AI 在这个项目里实现代码'
              : '需要先关联项目才能执行编排任务'
          }
          className="flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:border-emerald-500 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {orchestrating ? (
            <>
              <span className="inline-block h-3 w-3 animate-spin rounded-full border border-zinc-500 border-t-transparent" />
              执行中…
            </>
          ) : (
            <>⚡ 执行编排任务</>
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

      {/* 执行过程面板：让用户看得见到底执行了什么、在哪个目录 */}
      {showProgress && !pending && (
        <RunProgress
          phase={phase}
          logs={polishLogs}
          projectPath={project?.path ?? null}
          onClose={() => setShowProgress(false)}
        />
      )}

      {/* 执行编排前的确认：明确告知会改哪个目录，需勾选才能开始 */}
      {showRunConfirm && project && creation.filePath && (
        <RunConfirmDialog
          projectName={project.name}
          projectPath={project.path}
          docRelPath={creation.filePath}
          branch={creation.branch}
          roles={roles}
          defaultRoleId={creation.roleId ?? null}
          onCancel={() => setShowRunConfirm(false)}
          onConfirm={(role) => void startOrchestrate(role)}
        />
      )}

      {/* 编排执行过程：可中止 */}
      {showRunProgress && (
        <RunProgress
          phase={runPhase}
          logs={runLogs}
          projectPath={project?.path ?? null}
          running={orchestrating}
          summary={runSummary}
          onAbort={abortOrchestrate}
          onClose={() => setShowRunProgress(false)}
        />
      )}

      {orchestrateError && (
        <div className="absolute inset-x-0 bottom-0 z-30 mx-4 mb-4 flex items-start gap-2 rounded-xl border border-red-900/60 bg-red-950/90 px-4 py-3">
          <span className="text-xs text-red-200">{orchestrateError}</span>
          <button
            type="button"
            onClick={() => setOrchestrateError('')}
            className="ml-auto shrink-0 text-xs text-red-300/70 hover:text-red-200"
          >
            关闭
          </button>
        </div>
      )}

      {/* 生成开发计划：确认文件名 */}
      {showPlanDialog && (
        <PlanDialog
          requirementTitle={creation.title}
          projectName={project?.name ?? null}
          projectPath={project?.path ?? null}
          branch={creation.branch}
          onCancel={() => setShowPlanDialog(false)}
          onConfirm={(planName) => void startPlan(planName)}
        />
      )}

      {/* 生成过程面板 */}
      {showPlanProgress && (
        <RunProgress
          phase={planPhase}
          logs={planLogs}
          projectPath={project?.path ?? null}
          running={planning}
          onClose={() => setShowPlanProgress(false)}
        />
      )}

      {planError && (
        <div className="absolute inset-x-0 bottom-0 z-30 mx-4 mb-4 flex items-start gap-2 rounded-xl border border-red-900/60 bg-red-950/90 px-4 py-3">
          <span className="text-xs text-red-200">{planError}</span>
          <button
            type="button"
            onClick={() => setPlanError('')}
            className="ml-auto shrink-0 text-xs text-red-300/70 hover:text-red-200"
          >
            关闭
          </button>
        </div>
      )}
    </div>
  )
}
