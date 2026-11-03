export type ResultState = 'pending' | 'done' | 'failed'

export interface ResultItem {
  id: string
  name: string
  thumb: string
  state: ResultState
  /** state=done 时的识别文本(一图多码为多条) */
  texts: string[]
  /** state=failed 时的真实原因(引擎异常等);缺省 = 解码正常但未发现二维码 */
  error?: string
  /** 识别来源:屏幕选区 / 文件 / 拖动 / 粘贴 / 历史回显 */
  source?: string
  /** 源文件完整路径(桌面端文件/拖动来源;WebView2 经原生通道获取) */
  filePath?: string
  /** 完成识别的时间戳(用于卡片标注日期时间) */
  completedAt?: number
}

export interface ResultRenderOptions {
  /** 复制文本时触发(剪贴板写入与提示由装配层处理) */
  onCopy?: (text: string) => void
  /** 最新完成识别的条目 id:对应卡片以强调色描边并带"最新"徽标 */
  latestId?: string
}

/** 全量重绘结果列表(列表规模小,无需增量更新) */
export function renderResults(
  container: HTMLElement,
  items: ResultItem[],
  options: ResultRenderOptions = {},
): void {
  container.replaceChildren()
  for (const item of items) container.append(renderCard(item, options))
}

export function renderCard(item: ResultItem, options: ResultRenderOptions = {}): HTMLElement {
  const card = document.createElement('article')
  card.className = item.state === 'failed' ? 'result-card fail' : 'result-card'
  const isLatest = item.state !== 'pending' && item.id === options.latestId
  if (isLatest) card.classList.add('latest')
  card.dataset.testid = `result-card-${item.id}`

  if (item.thumb) {
    const box = document.createElement('div')
    box.className = 'thumb'
    const img = document.createElement('img')
    img.className = 'thumb-img'
    img.alt = item.name
    img.src = item.thumb
    box.append(img)
    card.append(box)
  }

  const body = document.createElement('div')
  body.className = 'card-body'
  if (item.state === 'pending') {
    body.append(message('识别中…'))
  } else {
    // meta 行:时间在前、来源居中、源文件路径随后——各卡片前缀信息保持对齐
    const meta = document.createElement('div')
    meta.className = 'card-meta'
    if (item.completedAt || item.source || item.filePath) {
      const stamp = document.createElement('span')
      stamp.className = 'card-meta-text'
      stamp.textContent = [
        item.completedAt ? formatDateTime(item.completedAt) : '',
        item.source ?? '',
        item.filePath ?? '',
      ]
        .filter(Boolean)
        .join(' · ')
      stamp.title = stamp.textContent
      meta.append(stamp)
    }
    if (meta.childElementCount > 0) body.append(meta)

    if (item.state === 'failed') {
      // 引擎异常时直接给出真实原因,避免误导用户去检查选区完整性
      body.append(
        message(
          item.error
            ? `识别异常:${item.error}`
            : '未识别到二维码(请确认选区完整包含二维码及其四周留白)',
        ),
      )
    } else {
      for (const text of item.texts) body.append(textRow(text, options))
    }
  }
  card.append(body)
  return card
}

/** 选中文本块全部内容(供"识别完成默认全选"复用;用户仍可鼠标部分选择) */
export function selectTextContents(el: HTMLElement): void {
  const range = document.createRange()
  // 优先选中内层文本行:避开块级边界的换行序列化(Ctrl+C 会带上尾部空行)
  const line = el.querySelector<HTMLElement>('.result-line')
  range.selectNodeContents(line ?? el)
  const selection = window.getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(range)
}

/** 单条文本行:默认单行省略(卡片等高),点击展开全部 + 右侧复制按钮 */
function textRow(text: string, options: ResultRenderOptions): HTMLElement {
  const row = document.createElement('div')
  row.className = 'result-row'

  const pre = document.createElement('p')
  pre.className = 'result-text collapsed'
  pre.dataset.testid = 'result-text'
  // 可编辑外观:点击出光标、可拖选复制;beforeinput 全拦截,内容不可被修改
  pre.setAttribute('contenteditable', 'plaintext-only')
  pre.spellcheck = false
  const line = document.createElement('span')
  line.className = 'result-line'
  line.textContent = text
  pre.append(line)
  pre.addEventListener('beforeinput', e => e.preventDefault())
  // 点击:光标落在点击位置(原生行为)+ 展开全部;点击块外收起(统一绑定)
  pre.addEventListener('click', () => {
    pre.classList.remove('collapsed')
    pre.classList.add('expanded')
  })
  row.append(pre)

  const actions = document.createElement('div')
  actions.className = 'row-actions'
  const copy = document.createElement('button')
  copy.textContent = '复制'
  copy.className = 'copy-button'
  copy.dataset.testid = 'copy-button'
  copy.addEventListener('click', () => options.onCopy?.(text))
  actions.append(copy)
  row.append(actions)
  return row
}

function message(text: string): HTMLElement {
  const p = document.createElement('p')
  p.className = 'card-msg'
  p.textContent = text
  return p
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** 年-月-日 时:分:秒(本地时区) */
export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * 文本块全局交互(幂等绑定):
 * 1. 点击文本块外任意位置 → 收起已展开的长文本(回到两行钳制);
 * 2. Ctrl+A(⌘A)时光标在文本块内 → 只选中该块内容,屏蔽整页全选。
 */
let interactionsBound = false
function bindTextInteractions(): void {
  if (interactionsBound) return
  interactionsBound = true
  document.addEventListener('pointerdown', event => {
    const node = event.target as Node | null
    document.querySelectorAll<HTMLElement>('.result-text.expanded').forEach(el => {
      if (node === null || !el.contains(node)) {
        el.classList.remove('expanded')
        el.classList.add('collapsed')
      }
    })
  })
  document.addEventListener(
    'keydown',
    event => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return
      const anchor = window.getSelection()?.anchorNode ?? null
      const start: Element | null = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null)
      const block = start?.closest<HTMLElement>('.result-text') ?? null
      if (!block) return
      event.preventDefault()
      selectTextContents(block)
    },
    true,
  )
}

// 模块加载即绑定(幂等):应用与测试环境行为一致
bindTextInteractions()
