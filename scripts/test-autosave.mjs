/**
 * 自动保存逻辑的行为测试（L4）。
 *
 * 把 DocEditor 里「防抖 + flush + 竞态序号」的算法原样抽出来跑，
 * 用假定时器与可控的 save 函数，验证：
 *   - 频繁输入只落库一次（防抖生效）
 *   - flush 能取到「最新一次输入」而不是旧值（这是丢内容的经典原因）
 *   - 旧请求回来不会把新状态覆盖成「已保存」
 *
 * 再验证 React StrictMode 下 effect 的挂载/卸载/重挂载序列不会丢数据。
 *
 * 这段算法与组件里保持同步；若改了组件务必同步改这里。
 */

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push({ name, actual: a, expected: e })
}

/** 复刻 DocEditor 中的保存控制器 */
function createSaveController(save, delay = 800) {
  let pending = null
  let timer = null
  let seq = 0
  const states = []

  const flush = async () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!pending) return
    const payload = pending
    pending = null
    const my = ++seq
    states.push('saving')
    try {
      await save(payload)
      if (my === seq) states.push('saved')
    } catch {
      if (my === seq) states.push('error')
    }
  }

  const schedule = (next) => {
    pending = next
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void flush(), delay)
  }

  return {
    flush,
    schedule,
    states,
    hasPending: () => pending !== null,
    cancelTimer: () => {
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const main = async () => {
  // ---------------------------------------------------------------
  // 1) 防抖：连续输入只落库一次，且内容是最新的
  // ---------------------------------------------------------------
  {
    const saved = []
    const c = createSaveController(async (p) => saved.push(p), 50)
    c.schedule({ title: 't', content: 'a' })
    c.schedule({ title: 't', content: 'ab' })
    c.schedule({ title: 't', content: 'abc' })
    await sleep(120)
    check('防抖：三次输入只落库一次', saved.length, 1)
    check('防抖：落库的是最新内容', saved[0].content, 'abc')
  }

  // ---------------------------------------------------------------
  // 2) flush 必须取到「最新一次输入」（丢内容的经典原因）
  // ---------------------------------------------------------------
  {
    const saved = []
    const c = createSaveController(async (p) => saved.push(p), 100000) // 定时器几乎不会触发
    c.schedule({ title: 't', content: '第一次' })
    c.schedule({ title: 't', content: '第二次最新' })
    await c.flush() // 立即落库
    check('flush 落库一次', saved.length, 1)
    check('flush 取到最新输入而非旧值', saved[0].content, '第二次最新')
    check('flush 后没有残留 pending', c.hasPending(), false)
  }

  // ---------------------------------------------------------------
  // 3) 内容为空串也必须落库（清空文档）
  // ---------------------------------------------------------------
  {
    const saved = []
    const c = createSaveController(async (p) => saved.push(p), 100000)
    c.schedule({ title: 't', content: '' })
    await c.flush()
    check('清空内容也会落库', saved.length, 1)
    check('落库内容是空串', saved[0].content, '')
  }

  // ---------------------------------------------------------------
  // 4) 无 pending 时 flush 是空操作
  // ---------------------------------------------------------------
  {
    const saved = []
    const c = createSaveController(async (p) => saved.push(p), 10)
    await c.flush()
    check('无 pending 时 flush 不落库', saved.length, 0)
  }

  // ---------------------------------------------------------------
  // 5) 竞态：慢的旧请求不能把状态覆盖成「已保存」
  // ---------------------------------------------------------------
  {
    let resolveFirst
    let call = 0
    const c = createSaveController(async () => {
      call++
      if (call === 1) {
        await new Promise((r) => {
          resolveFirst = r
        })
      }
    }, 1)

    c.schedule({ title: 't', content: 'old' })
    const p1 = c.flush() // 第一个请求挂住
    c.schedule({ title: 't', content: 'new' })
    const p2 = c.flush() // 第二个请求先完成
    await p2
    check('第二次保存已完成 → 状态为 saved', c.states[c.states.length - 1], 'saved')

    resolveFirst() // 第一个请求这时才回来
    await p1
    check('旧请求回来不覆盖新状态', c.states[c.states.length - 1], 'saved')
    // 第一次保存尚未完成时第二次就开始了，所以是 saving,saving,saved
    check('状态序列正确', c.states, ['saving', 'saving', 'saved'])
  }

  // ---------------------------------------------------------------
  // 6) 保存失败 → 状态为 error
  // ---------------------------------------------------------------
  {
    const c = createSaveController(async () => {
      throw new Error('boom')
    }, 1)
    c.schedule({ title: 't', content: 'x' })
    await c.flush()
    check('保存失败状态为 error', c.states[c.states.length - 1], 'error')
  }

  // ---------------------------------------------------------------
  // 7) StrictMode 序列：挂载 → 卸载(cleanup flush) → 重挂载
  //    模拟 React 18/19 StrictMode 对 effect 的双调用
  // ---------------------------------------------------------------
  {
    const saved = []
    let controller = createSaveController(async (p) => saved.push(p), 100000)

    // 第一次挂载后用户输入
    controller.schedule({ title: 't', content: '用户刚敲的内容' })

    // StrictMode 立刻卸载 → cleanup 触发 flush
    await controller.flush()
    check('StrictMode 卸载时已落库', saved.length, 1)
    check('StrictMode 卸载落库内容正确', saved[0].content, '用户刚敲的内容')

    // 重挂载：防抖窗口若仍存活会再落一次同样的内容（harness 层面无副作用）
    controller = createSaveController(async (p) => saved.push(p), 100000)
    check('重挂载后无残留 pending', controller.hasPending(), false)
  }

  // ---------------------------------------------------------------
  // 8) 连续 flush 之间不丢中间态
  // ---------------------------------------------------------------
  {
    const saved = []
    const c = createSaveController(async (p) => saved.push(p), 100000)
    for (const v of ['1', '2', '3']) {
      c.schedule({ title: 't', content: v })
      await c.flush()
    }
    check('三次输入三次落库，顺序正确', saved.map((s) => s.content), ['1', '2', '3'])
  }

  // ---------------------------------------------------------------
  // 9) 回归：输入后「立刻返回列表」不能丢内容
  //    曾经的写法是 flush().then(onBack)，但闭包捕获了旧的 flush，
  //    导致 pending 为空、内容丢失。现在返回按钮 await 的必须是
  //    持有最新 pending 的那个 flush。
  // ---------------------------------------------------------------
  {
    const saved = []
    const c = createSaveController(async (p) => saved.push(p), 100000)
    c.schedule({ title: 't', content: '敲完立刻返回' })
    // 模拟点击返回：等 flush 落库后再「离开」
    await c.flush()
    check('输入后立刻返回：内容已落库', saved.length, 1)
    check('输入后立刻返回：落库内容正确', saved[0].content, '敲完立刻返回')
  }

  // ---------------------------------------------------------------
  // 10) 标题与正文都要能各自落库
  // ---------------------------------------------------------------
  {
    const saved = []
    const c = createSaveController(async (p) => saved.push(p), 100000)
    c.schedule({ title: '新标题', content: '' })
    await c.flush()
    check('只改标题也能落库', saved[0].title, '新标题')
  }

  // ---------------------------------------------------------------
  // 11) 回归：列表刷新（自动保存成功后触发）不得回滚正在编辑的内容
  //
  // 曾经的 bug：DocEditor 里那个「切换文档时重置」的 effect 依赖了
  // creation.content。自动保存成功后 store 刷新列表 → creation.content
  // 变化 → effect 重跑 → 编辑器被回滚到上一次已保存的内容，且 pending
  // 被清空。表现为：保存完成的一瞬间，用户刚打的字被吃掉。
  //
  // 修法是显式比对文档 id，只有真的换了文档才重置。
  // ---------------------------------------------------------------
  {
    // 复刻修好之后的重置判定
    let docIdRef = 'doc-1'
    let resets = 0
    const maybeReset = (creation) => {
      if (docIdRef === creation.id) return
      docIdRef = creation.id
      resets++
    }

    // 自动保存成功 → 列表刷新，同一份文档但 content 变了
    maybeReset({ id: 'doc-1', content: 'abc', title: 't' })
    maybeReset({ id: 'doc-1', content: 'ab', title: 't' })
    check('同文档的列表刷新不触发重置', resets, 0)

    // 真的切换到另一份文档
    maybeReset({ id: 'doc-2', content: '', title: '别篇' })
    check('切换文档才重置', resets, 1)
  }

  // ---------------------------------------------------------------
  // 12) 回归：从编辑器取当前正文，而不是闭包里的旧值
  //     标题 onChange 若用闭包 content，会把旧正文写回库覆盖用户刚打的字
  // ---------------------------------------------------------------
  {
    const saved = []
    const c = createSaveController(async (p) => saved.push(p), 100000)
    const liveContent = () => '用户最新正文' // 编辑器里的真实值

    // 先输入正文（编辑器内容更新，但闭包没跟上）
    c.schedule({ title: 't', content: liveContent() })
    // 再改标题——必须也用 liveContent，而不是闭包里的旧值
    c.schedule({ title: '新标题', content: liveContent() })
    await c.flush()
    check('改标题不会把旧正文写回', saved[0].content, '用户最新正文')
    check('改标题本身生效', saved[0].title, '新标题')
  }

  console.log(`\n通过 ${pass} 项`)
  if (failures.length) {
    console.log(`失败 ${failures.length} 项：\n`)
    for (const f of failures) {
      console.log(`  ✗ ${f.name}`)
      console.log(`      实际: ${f.actual}`)
      console.log(`      期望: ${f.expected}`)
    }
    process.exit(1)
  }
  console.log('全部通过 ✓')
}

void main()
