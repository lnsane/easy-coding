import type { Action } from '../lib/markdown-actions'
import {
  bold,
  italic,
  strike,
  inlineCode,
  heading,
  unorderedList,
  orderedList,
  quote,
  table,
  codeBlock,
  link,
  image,
  horizontalRule
} from '../lib/markdown-actions'

interface Props {
  /** 应用某个变换动作 */
  onAction: (action: Action) => void
  /** 撤销/重做走 CodeMirror 内建 history */
  onUndo: () => void
  onRedo: () => void
}

interface ToolItem {
  key: string
  label: string
  title: string
  run: (p: Props) => void
}

/** 按钮分组，组间用竖线分隔 */
const GROUPS: ToolItem[][] = [
  [
    { key: 'bold', label: 'B', title: '加粗 (Ctrl+B)', run: (p) => p.onAction(bold) },
    { key: 'italic', label: 'I', title: '斜体 (Ctrl+I)', run: (p) => p.onAction(italic) },
    { key: 'strike', label: 'S', title: '删除线', run: (p) => p.onAction(strike) },
    { key: 'code', label: '</>', title: '行内代码', run: (p) => p.onAction(inlineCode) }
  ],
  [
    { key: 'h1', label: 'H1', title: '一级标题', run: (p) => p.onAction(heading(1)) },
    { key: 'h2', label: 'H2', title: '二级标题', run: (p) => p.onAction(heading(2)) },
    { key: 'h3', label: 'H3', title: '三级标题', run: (p) => p.onAction(heading(3)) }
  ],
  [
    { key: 'ul', label: '• 列表', title: '无序列表', run: (p) => p.onAction(unorderedList) },
    { key: 'ol', label: '1. 列表', title: '有序列表', run: (p) => p.onAction(orderedList) },
    { key: 'quote', label: '❝', title: '引用', run: (p) => p.onAction(quote) }
  ],
  [
    { key: 'table', label: '▦ 表格', title: '插入表格', run: (p) => p.onAction(table) },
    { key: 'link', label: '🔗 链接', title: '插入超链接', run: (p) => p.onAction(link) },
    { key: 'image', label: '🖼 图片', title: '插入图片', run: (p) => p.onAction(image) },
    { key: 'hr', label: '―', title: '分割线', run: (p) => p.onAction(horizontalRule) },
    { key: 'codeblock', label: '{ }', title: '代码块', run: (p) => p.onAction(codeBlock) }
  ],
  [
    { key: 'undo', label: '↶', title: '撤销 (Ctrl+Z)', run: (p) => p.onUndo() },
    { key: 'redo', label: '↷', title: '重做 (Ctrl+Shift+Z)', run: (p) => p.onRedo() }
  ]
]

/** markdown 工具栏 */
export default function MarkdownToolbar(props: Props): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5">
      {GROUPS.map((group, gi) => (
        <div key={gi} className="flex items-center">
          {gi > 0 && <span className="mx-1 h-4 w-px bg-zinc-700" />}
          {group.map((item) => (
            <button
              key={item.key}
              type="button"
              title={item.title}
              // 用 onMouseDown 阻止默认：否则点按钮会先让编辑器失焦，
              // 选区丢失，插入类动作就作用不到原位置了。
              onMouseDown={(e) => {
                e.preventDefault()
                item.run(props)
              }}
              className={`min-w-7 rounded px-1.5 py-1 text-xs leading-none text-zinc-300 transition hover:bg-zinc-700 hover:text-zinc-100 ${
                item.key === 'bold' ? 'font-bold' : ''
              } ${item.key === 'italic' ? 'italic' : ''} ${item.key === 'strike' ? 'line-through' : ''}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
