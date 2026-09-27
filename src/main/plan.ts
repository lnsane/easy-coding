import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { resolveClaudeBinary } from './claude-bin'
import type { PolishLog } from './polish'
import { PLAN_SYSTEM_PROMPT } from '../shared/prompts'
import { cleanCliOutput } from './cli-output'
import { killTree } from './kill-tree'

/**
 * 生成开发计划文档。
 *
 * 与润色的区别：润色是「改写现有文档」，这里是「读需求 → 产出一份新的计划文档」。
 *
 * 用**只读检索模式**（`Read,Glob,Grep`）：它能先看项目里已有什么再写计划，
 * 但改不了任何文件。计划内容由它打印到 stdout，再由应用负责落盘——
 * 文件名、路径、重名处理都在应用侧统一管。
 */

export interface PlanResult {
  ok: boolean
  /** 生成的计划文档正文（markdown） */
  text: string
  error?: string
}

export type PlanLogFn = (log: PolishLog) => void

/**
 * 只读检索工具白名单。
 *
 * 给计划生成开这三个工具，是为了让它**先看项目里已有什么**再写计划——
 * 否则它只能照需求文本推演，会把已实现的功能当成待做
 * （实测：它曾把「角色配置/持久化/界面」列成待开发，而那些已经实现）。
 *
 * ⚠️ 刻意**不含 Write / Edit / Bash**：
 * - 计划只需产出文本，不该改任何文件
 * - 实测该组合下：能读到代码内容，但建不了文件、哨兵文件哈希不变
 * - 只读工具**不需要** `--dangerously-skip-permissions`（那会连写权限一起放开）
 */
const ALLOWED_TOOLS = 'Read,Glob,Grep'


/**
 * 超时上限：5 小时。
 *
 * 演进：8 分钟 → 20 分钟 → 5 小时。8 分钟那次实测被中止（日志显示
 * 480.0s 超时，且当时仍在正常工作）。本机 Claude Code 被路由到国产模型，
 * 速度比官方模型慢不少，而计划生成是「读较多文件 + 产出长文档」，耗时天然长。
 *
 * 定得这么宽是有意的：宁可让用户自己关掉面板，也不要中途把还在干的活掐掉。
 * 目前没有「中止」按钮——若需要中途停，可以后续补（killTree 已就绪）。
 */
const TIMEOUT_MS = 5 * 60 * 60 * 1000

/**
 * 依据需求文档内容生成开发计划。
 *
 * @param sourceContent 需求文档正文
 * @param title         需求标题，用于让模型知道在给什么写计划
 * @param cwd           工作目录（项目根），用于加载 CLAUDE.md 等上下文
 * @param onLog         执行过程回调
 */
function generatePlanOnce(
  sourceContent: string,
  title: string,
  cwd?: string | null,
  onLog?: PlanLogFn
): Promise<PlanResult> {
  const startedAt = Date.now()
  const log = (kind: PolishLog['kind'], text: string): void => {
    try {
      onLog?.({ kind, text, at: Date.now() })
    } catch {
      // 日志回调不影响主流程
    }
  }
  const elapsed = (): string => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`

  return new Promise((resolve) => {
    const bin = resolveClaudeBinary()
    if (!bin) {
      log('err', '未找到 Claude Code CLI')
      resolve({
        ok: false,
        text: '',
        error:
          '未找到 Claude Code CLI。请先安装：npm i -g @anthropic-ai/claude-code，或在 https://claude.com/claude-code 下载桌面版。'
      })
      return
    }
    log('info', `已找到 Claude Code：${bin}`)

    if (!sourceContent.trim()) {
      log('err', '需求文档内容为空')
      resolve({ ok: false, text: '', error: '需求文档内容为空，无法生成开发计划。' })
      return
    }

    const workdir = cwd && fs.existsSync(cwd) ? cwd : undefined
    log('info', `工作目录：${workdir ?? '（应用默认目录，未关联项目）'}`)
    if (workdir) {
      const claudeMd = path.join(workdir, 'CLAUDE.md')
      log(
        'info',
        fs.existsSync(claudeMd)
          ? '该项目存在 CLAUDE.md，会作为上下文一并加载'
          : '该项目没有 CLAUDE.md'
      )
    }
    log('info', `只读检索模式：工具白名单 ${ALLOWED_TOOLS}（无 Write / Edit / Bash，改不了任何文件）`)
    log('info', '需求内容经 stdin 管道送入；它会先检索项目现状，再据此写计划')
    log(
      'cmd',
      `claude -p --tools "${ALLOWED_TOOLS}" --append-system-prompt <计划规则>   ` +
        `# 需求「${title}」共 ${sourceContent.trim().length} 字符，经 stdin 传入`
    )

    let child
    try {
      child = spawn(bin, ['-p', '--tools', ALLOWED_TOOLS, '--append-system-prompt', PLAN_SYSTEM_PROMPT], {
        cwd: workdir,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (err) {
      log('err', `进程启动失败：${String(err)}`)
      resolve({ ok: false, text: '', error: `启动 Claude Code 失败：${String(err)}` })
      return
    }

    log('info', '已启动子进程，等待生成开发计划…')

    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (r: PlanResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }

    const timer = setTimeout(() => {
      // 必须杀整棵进程树：child.kill() 只杀直接子进程，claude.exe 会变孤儿
      // 继续跑（实测残留，继续消耗 token）
      killTree(child.pid)
      log('err', `超时中止（${elapsed()}）`)
      finish({
        ok: false,
        text: '',
        error: `生成超时（${Math.round(TIMEOUT_MS / 60000)} 分钟），已中止。请重试。`
      })
    }, TIMEOUT_MS)

    child.stdout?.on('data', (d: Buffer) => {
      const s = d.toString('utf8')
      stdout += s
      log('out', `收到 ${s.length} 字符（累计 ${stdout.length}）`)
    })
    child.stderr?.on('data', (d: Buffer) => {
      const s = d.toString('utf8')
      stderr += s
      log('err', s.trim().slice(0, 300))
    })
    child.on('error', (err) => {
      log('err', `无法执行：${err.message}`)
      finish({ ok: false, text: '', error: `无法执行 Claude Code：${err.message}` })
    })
    child.on('close', (code) => {
      // 已被超时/中止处理过就不再重复报告。
      // 否则 killTree 之后 close 仍会触发，日志里会多出一条「退出码 null」，
      // 看起来像发生了两次失败（实测出现过）。
      if (settled) return

      const text = stdout.trim()
      if (code !== 0) {
        const detail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-3).join('\n')
        log('err', `退出码 ${code}（耗时 ${elapsed()}）`)
        finish({
          ok: false,
          text: '',
          error: `Claude Code 退出码 ${code}${detail ? `：\n${detail}` : ''}`
        })
        return
      }
      if (!text) {
        log('err', `无输出（耗时 ${elapsed()}）`)
        finish({ ok: false, text: '', error: 'Claude Code 没有返回内容。' })
        return
      }
      const cleaned = cleanCliOutput(text)

      // 兜底：模型偶尔会无视「不要调用工具」，输出工具调用的残留标记
      // （形如 <｜｜DSML｜｜ invoke name="Bash">）。由于工具已被禁用，
      // 这些调用不会真的执行，但**残留文本会污染文档**。
      // 与其把垃圾写进文件，不如判定为失败让用户重试。
      if (looksLikeToolCall(cleaned)) {
        log('err', '模型输出了工具调用残留，判定为失败（工具已禁用，无法执行）')
        finish({
          ok: false,
          text: '',
          error:
            '这次生成没有产出计划正文，而是输出了工具调用内容（可能想先查看项目文件）。\n' +
            '请重试一次；若反复出现，可减小需求文档篇幅或先在需求里写明不依赖项目探查。'
        })
        return
      }

      log('done', `生成完成，${cleaned.length} 字符，耗时 ${elapsed()}`)
      finish({ ok: true, text: cleaned })
    })

    if (child.stdin) {
      child.stdin.on('error', () => {
        // 子进程提前退出时写 stdin 会报 EPIPE，属正常情况
      })
      child.stdin.write(
        (workdir
          ? `下面是需求文档《${title}》的内容。当前工作目录就是项目根目录，` +
            `请先用 Read/Glob/Grep 了解项目现状（哪些已实现、哪些还没有），再据此生成开发计划。\n\n`
          : `下面是需求文档《${title}》的内容，请据此生成开发计划。\n\n`) + sourceContent,
        'utf8'
      )
      child.stdin.end()
    }
  })
}

/**
 * 判断输出是否是「工具调用残留」。
 *
 * 实测偶发：模型会尝试调用白名单外的工具（如 Bash），或在没有可用工具时
 * 仍输出工具调用格式，在 stdout 里留下形如
 * `<｜｜DSML｜｜ invoke name="Bash">` 的畸形标记。
 * 这类输出不是计划正文，必须识别出来而不是当成功写进文档。
 */
function looksLikeToolCall(text: string): boolean {
  if (/DSML|invoke name=|antml:invoke/i.test(text)) return true
  // 没有任何 markdown 标题，基本可以断定不是计划正文
  return !/^\s*#/m.test(text)
}

/** 计划文档的默认文件名（不含扩展名）：开发计划-<需求标题> */
export function defaultPlanName(requirementTitle: string): string {
  return `开发计划-${requirementTitle}`
}

/**
 * 依据需求生成开发计划，失败时自动重试一次。
 *
 * 为什么要重试：实测发现模型偶尔会无视「不要调用工具」的指令，
 * 转而输出工具调用残留（想先探查项目）。这是**间歇性**的——同样的输入
 * 重跑一次通常就正常。与其让用户手动重点，不如内部重试。
 *
 * 只对这类「输出不合格」重试；超时、找不到 CLI 等失败不重试（重试也不会好）。
 */
export async function generatePlan(
  sourceContent: string,
  title: string,
  cwd?: string | null,
  onLog?: PlanLogFn
): Promise<PlanResult> {
  const first = await generatePlanOnce(sourceContent, title, cwd, onLog)
  if (first.ok) return first

  // 仅当失败原因是「没产出合格正文」时才重试
  const retriable = first.error?.includes('工具调用') ?? false
  if (!retriable) return first

  try {
    onLog?.({
      kind: 'info',
      text: '首次未产出合格正文，自动重试一次…',
      at: Date.now()
    })
  } catch {
    // 忽略日志回调异常
  }
  return generatePlanOnce(sourceContent, title, cwd, onLog)
}
