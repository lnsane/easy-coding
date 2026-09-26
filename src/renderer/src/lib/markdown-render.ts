import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({
  gfm: true,
  breaks: true
})

/**
 * markdown → 可安全塞进 innerHTML 的 HTML。
 *
 * 预览是用 dangerouslySetInnerHTML 渲染的，**必须**过 DOMPurify：
 * 正文可能包含 <script>、onerror=、javascript: 之类的内容，
 * 不过滤等于在应用里开了个 XSS 口子。
 */
export function renderMarkdown(source: string): string {
  if (!source.trim()) return ''
  const raw = marked.parse(source, { async: false }) as string
  return DOMPurify.sanitize(raw, {
    // 链接/图片的属性保留，但协议白名单由 DOMPurify 默认策略把关
    ADD_ATTR: ['target', 'rel']
  })
}
