import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { initGeneratePanel } from './generator/panel'
import { createEngine } from './scanner/engine'
import { createIngest, isImageFile } from './scanner/ingest'
import { createSerialQueue } from './scanner/queue'
import { renderResults, selectTextContents, type ResultItem } from './scanner/results'
import { log } from './shared/log'
import { createProgress, hideToast, showToast } from './shared/status'
import { getTheme, setTheme } from './shared/theme'

log('app', `主窗启动(桌面:${'__TAURI_INTERNALS__' in window ? '是' : '否'})`)

const isTauri = '__TAURI_INTERNALS__' in window

// 双 Tab:识别 | 生成
const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab[data-tab]'))
function switchTab(name: string): void {
  for (const button of tabButtons) {
    const active = button.dataset.tab === name
    button.classList.toggle('active', active)
    button.setAttribute('aria-selected', String(active))
  }
  ;(document.getElementById('panel-scan') as HTMLElement).hidden = name !== 'scan'
  ;(document.getElementById('panel-generate') as HTMLElement).hidden = name !== 'generate'
}
for (const button of tabButtons) {
  button.addEventListener('click', () => switchTab(button.dataset.tab ?? 'scan'))
}
switchTab('scan')
initGeneratePanel()

const appRoot = document.getElementById('app') as HTMLElement
const pickButton = document.getElementById('pick-button') as HTMLButtonElement
const regionButton = document.getElementById('region-button') as HTMLButtonElement
const fileInput = document.getElementById('file-input') as HTMLInputElement
const progressEl = document.getElementById('progress') as HTMLElement
const resultsEl = document.getElementById('results') as HTMLElement
const emptyHint = document.getElementById('empty-hint') as HTMLElement
const toastEl = document.getElementById('toast') as HTMLElement
const clearButton = document.getElementById('clear-button') as HTMLButtonElement

const engine = createEngine()
const ingest = createIngest()
const queue = createSerialQueue()
const progress = createProgress(progressEl)

// 配色主题:黑绿/黑黄切换,持久化到 localStorage(首帧前由 index.html 内联脚本应用);
// 按钮只保留"配色"文字,当前主题由右侧色块呈现,色块用 var(--accent) 随主题自动变色
const themeToggle = document.getElementById('theme-toggle') as HTMLButtonElement
themeToggle.addEventListener('click', () => {
  setTheme(getTheme() === 'black-yellow' ? 'black-green' : 'black-yellow')
})

// ---- 全局快捷键:点击工具条徽章就地修改(按新组合键),localStorage 持久化 ----
const HOTKEY_LS_KEY = 'qr.hotkeys.v1'
type Hotkeys = { region: string; toggle: string }
const HOTKEY_DEFAULT: Hotkeys = { region: 'alt+q', toggle: 'alt+w' }
const hkRegion = document.getElementById('hk-region') as HTMLButtonElement
const hkToggle = document.getElementById('hk-toggle') as HTMLButtonElement

function loadHotkeys(): Hotkeys {
  try {
    const raw = JSON.parse(localStorage.getItem(HOTKEY_LS_KEY) ?? 'null') as Partial<Hotkeys> | null
    const region = typeof raw?.region === 'string' && raw.region ? raw.region : HOTKEY_DEFAULT.region
    const toggle = typeof raw?.toggle === 'string' && raw.toggle ? raw.toggle : HOTKEY_DEFAULT.toggle
    if (region !== toggle) return { region, toggle }
  } catch { /* 存储不可用走默认 */ }
  return { ...HOTKEY_DEFAULT }
}

function fmtHotkey(k: string): string {
  return k
    .split('+')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join('+')
}

/** 徽章唯一渲染出口:文本与 listening 呼吸态都由 hkRecording 派生。
 *  录制结束/取消必须回到这里——曾只改文本不移除 listening 类,呼吸动画永不停。 */
function renderHotkeyBadges(hk: Hotkeys): void {
  const base: Record<'region' | 'toggle', string> = {
    region: `选区 ${fmtHotkey(hk.region)}`,
    toggle: `显隐 ${fmtHotkey(hk.toggle)}`,
  }
  for (const kind of ['region', 'toggle'] as const) {
    const el = kind === 'region' ? hkRegion : hkToggle
    const recording = hkRecording === kind
    el.classList.toggle('listening', recording)
    el.textContent = recording ? '按下新组合键…' : base[kind]
  }
}

async function applyHotkeys(hk: Hotkeys): Promise<string | null> {
  if (!isTauri) return null // 浏览器形态:热键不生效,仅展示/持久化
  try {
    await invoke('register_hotkeys', { region: hk.region, toggle: hk.toggle })
    return null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log('hotkey', `快捷键注册失败:${msg}`)
    return msg
  }
}

let hkRecording: 'region' | 'toggle' | null = null
function disarmHotkeyRecording(): void {
  hkRecording = null
  // 恢复录制开始时挂起的全局热键(Esc 取消 / 窗口失焦路径)
  void applyHotkeys(loadHotkeys())
  renderHotkeyBadges(loadHotkeys())
}

function startHotkeyRecording(kind: 'region' | 'toggle'): void {
  hkRecording = kind
  renderHotkeyBadges(loadHotkeys())
  // 录制期间挂起全局热键:按下的新组合键若与当前热键相同(如重录 Alt+Q),
  // 会被系统级热键直接捕获而触发选区/显隐,与录制竞争
  if (isTauri) {
    void invoke('suspend_hotkeys').catch(err => log('hotkey', `挂起快捷键失败:${String(err)}`))
  }
}

hkRegion.addEventListener('click', () => startHotkeyRecording('region'))
hkToggle.addEventListener('click', () => startHotkeyRecording('toggle'))

// 录制:捕获下一次组合键(需含 Ctrl/Alt;Esc 取消;纯修饰键等待主键)
document.addEventListener(
  'keydown',
  event => {
    if (!hkRecording) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      disarmHotkeyRecording()
      return
    }
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return
    const mods = [
      event.ctrlKey && 'ctrl',
      event.altKey && 'alt',
      event.shiftKey && 'shift',
      event.metaKey && 'meta',
    ].filter(Boolean) as string[]
    if (mods.length === 0) {
      flashToast('快捷键需包含 Ctrl 或 Alt 修饰键')
      return
    }
    const key = event.key === ' ' ? 'space' : event.key.toLowerCase()
    const combo = [...mods, key].join('+')
    const kind = hkRecording
    hkRecording = null
    void (async () => {
      const prev = loadHotkeys()
      const hk: Hotkeys = { ...prev, [kind]: combo }
      const err = await applyHotkeys(hk)
      if (err) {
        flashToast(`修改失败:${err}`)
        void applyHotkeys(prev) // 注册失败也恢复旧键(录制开始时已挂起)
      } else {
        try {
          localStorage.setItem(HOTKEY_LS_KEY, JSON.stringify(hk))
        } catch { /* 存储不可用,仅本次会话生效 */ }
        flashToast('快捷键已更新')
      }
      renderHotkeyBadges(loadHotkeys())
    })()
  },
  true,
)

// 录制中窗口失焦(切走):取消录制并恢复热键,避免热键一直处于挂起
window.addEventListener('blur', () => {
  if (hkRecording) disarmHotkeyRecording()
})

// 启动:按持久化配置注册热键
renderHotkeyBadges(loadHotkeys())
void (async () => {
  const err = await applyHotkeys(loadHotkeys())
  if (err) log('hotkey', `启动注册快捷键失败:${err}`)
})()

// ---- 帮助浮层:版本 + GitHub 最新版/项目主页 ----
const helpBtn = document.getElementById('help-btn') as HTMLButtonElement
const helpPop = document.getElementById('help-pop') as HTMLElement
const helpVer = document.getElementById('help-ver') as HTMLElement
helpBtn.addEventListener('click', () => {
  helpPop.hidden = !helpPop.hidden
  if (!helpPop.hidden && isTauri) {
    void import('@tauri-apps/api/app')
      .then(m => m.getVersion())
      .then(v => {
        helpVer.textContent = `v${v}`
      })
      .catch(() => (helpVer.textContent = ''))
  }
})
document.addEventListener('pointerdown', event => {
  if (helpPop.hidden) return
  const node = event.target as Node | null
  if (node instanceof Element && (helpPop.contains(node) || helpBtn.contains(node))) return
  helpPop.hidden = true
})
helpPop.addEventListener('click', event => {
  const a = (event.target as Element).closest('a[data-gh]')
  if (!a || !isTauri) return
  event.preventDefault()
  void invoke('open_github', { target: a.getAttribute('data-gh') }).catch(err => log('help', `打开链接失败:${String(err)}`))
})

const items: ResultItem[] = []
let uidCounter = 0
// 最新完成识别的条目:结果卡片着重显示
let latestDoneId = ''
let toastTimer: number | undefined

function refresh(): void {
  renderResults(resultsEl, items, { onCopy: handleCopy, latestId: latestDoneId })
  emptyHint.hidden = items.length > 0
  clearButton.hidden = items.length === 0
}

function refreshProgress(): void {
  const total = items.length
  const done = items.filter(it => it.state !== 'pending').length
  if (done < total) progress.show(`识别中 ${done}/${total}…`)
  else progress.hide()
}

function flashToast(message: string): void {
  showToast(toastEl, message)
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => hideToast(toastEl), 2000)
}

// 清空识别记录(独立红色卡片):WebView2 无原生 confirm,二次点击确认,3s 未确认自动解除
let clearArmed = false
let clearArmTimer: number | undefined
function disarmClear(): void {
  clearArmed = false
  window.clearTimeout(clearArmTimer)
  clearButton.textContent = '清空'
}
clearButton.addEventListener('click', () => {
  if (!clearArmed) {
    clearArmed = true
    clearButton.textContent = '再点一次确认清空'
    clearArmTimer = window.setTimeout(disarmClear, 3000)
    return
  }
  disarmClear()
  items.length = 0
  latestDoneId = ''
  refresh()
  refreshProgress()
  flashToast('已清空识别记录')
})

async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 降级到 execCommand
    }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  return ok
}

function handleCopy(text: string): void {
  void copyToClipboard(text).then(ok => flashToast(ok ? '已复制' : '复制失败'))
}

function findItem(id: string): ResultItem | undefined {
  return items.find(it => it.id === id)
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  bmp: 'image/bmp',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** 桌面:按路径读图(原生对话框/原生拖放);meta 行可显示完整源文件路径 */
async function handleImagePaths(paths: string[], source: string): Promise<void> {
  if (paths.length === 0) return
  try {
    const results = await invoke<
      Array<{ path: string; name: string; ok: boolean; base64: string; error: string }>
    >('read_image_files', { paths })
    const files: File[] = []
    const filePaths: string[] = []
    for (const r of results) {
      if (!r.ok) {
        flashToast(`无法读取:${r.name}`)
        log('scan', `读取文件失败:${r.path} ${r.error}`)
        continue
      }
      const ext = r.name.split('.').pop()?.toLowerCase() ?? ''
      const type = IMAGE_MIME[ext]
      if (!type) {
        flashToast(`不支持的图片格式:${r.name}`)
        log('scan', `忽略非图片文件:${r.path}`)
        continue
      }
      const bin = atob(r.base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      files.push(new File([bytes], r.name, { type }))
      filePaths.push(r.path)
    }
    if (files.length > 0) enqueueFiles(files, source, filePaths)
  } catch (err) {
    log('scan', `读取图片失败:${String(err)}`)
    flashToast('读取图片失败')
  }
}

async function decodeItem(uid: string, file: File): Promise<void> {
  const t0 = performance.now()
  try {
    const task = await ingest.fromBlob(file, file.name)
    const item = findItem(uid)
    if (item) item.thumb = task.thumb
    refresh()
    log('scan', `位图就绪 ${task.bitmap.width}x${task.bitmap.height},预处理 ${Math.round(performance.now() - t0)}ms`)
    const texts = await engine.decode(task.bitmap)
    const target = findItem(uid)
    if (target) {
      target.state = texts.length > 0 ? 'done' : 'failed'
      target.texts = texts
      target.completedAt = Date.now()
      // 最新完成的卡片移到最前
      const idx = items.indexOf(target)
      if (idx > 0) {
        items.splice(idx, 1)
        items.unshift(target)
      }
    }
    latestDoneId = uid
    log('scan', `解码完成 ${Math.round(performance.now() - t0)}ms,结果 ${texts.length} 条`)
  } catch (err) {
    const target = findItem(uid)
    if (target) {
      target.state = 'failed'
      target.error = err instanceof Error ? err.message : String(err)
      target.completedAt = Date.now()
      const idx = items.indexOf(target)
      if (idx > 0) {
        items.splice(idx, 1)
        items.unshift(target)
      }
    }
    latestDoneId = uid
    log('scan', `识别失败:${err instanceof Error ? err.message : String(err)}`)
  }
  // 屏幕选区识别失败(异常或 0 结果):把裁剪样张落盘,便于核对引擎实际看到的内容
  const target = findItem(uid)
  if (target && target.state === 'failed' && file.name === '屏幕选区.png' && lastRegionPngBase64) {
    try {
      const path = await invoke<string>('dump_failed_region', { pngBase64: lastRegionPngBase64 })
      log('scan', `失败选区样张已保存:${path}`)
    } catch (err) {
      log('scan', `样张落盘失败:${String(err)}`)
    }
  }
  refresh()
  refreshProgress()
  // 识别成功后默认全选文本块,可直接 Ctrl+C 或点右侧复制
  if (target && target.state === 'done') {
    const el = resultsEl.querySelector<HTMLElement>('.result-card.latest .result-text')
    if (el) selectTextContents(el)
  }
}

function enqueueFiles(files: ArrayLike<File>, source: string, filePaths?: string[]): void {
  const all = Array.from(files)
  const images = all.filter(isImageFile)
  if (images.length === 0) {
    if (all.length > 0) flashToast('未发现图片文件')
    log('scan', `入队忽略:${all.length} 个文件均非图片`)
    return
  }
  log('scan', `入队 ${images.length} 张图片,来源 ${source}(忽略非图片 ${all.length - images.length} 个)`)
  for (const [index, file] of images.entries()) {
    const uid = `item-${++uidCounter}`
    items.push({
      id: uid,
      name: file.name,
      thumb: '',
      state: 'pending',
      texts: [],
      source,
      filePath: filePaths?.[index],
    })
    refresh()
    void queue.add(() => decodeItem(uid, file))
  }
  refreshProgress()
}

// 输入路径 1:文件选择(浏览器:HTML input;桌面:原生对话框——WebView2 不向网页暴露文件路径)
if (isTauri) {
  pickButton.addEventListener('click', () => {
    void invoke<string[]>('pick_image_files')
      .then(paths => handleImagePaths(paths, '文件'))
      .catch(err => {
        log('scan', `文件对话框失败:${String(err)}`)
        flashToast('打开文件对话框失败')
      })
  })
} else {
  pickButton.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) enqueueFiles(fileInput.files, '文件')
    fileInput.value = ''
  })
}

// 输入路径 2:窗口级拖拽(浏览器路径;桌面端 Tauri 原生拖放接管,不触发 HTML5 事件,见 isTauri 块)
for (const type of ['dragenter', 'dragover'] as const) {
  window.addEventListener(type, (event: DragEvent) => {
    event.preventDefault()
    appRoot.classList.add('dragging')
  })
}
window.addEventListener('dragleave', (event: DragEvent) => {
  if (event.relatedTarget === null) appRoot.classList.remove('dragging')
})
window.addEventListener('drop', (event: DragEvent) => {
  event.preventDefault()
  appRoot.classList.remove('dragging')
  if (event.dataTransfer?.files.length) enqueueFiles(event.dataTransfer.files, '拖动')
})

// 输入路径 3:粘贴截图
document.addEventListener('paste', (event: ClipboardEvent) => {
  const transferred = event.clipboardData?.items
  if (!transferred) return
  const files: File[] = []
  for (let i = 0; i < transferred.length; i++) {
    if (!transferred[i].type.startsWith('image/')) continue
    const file = transferred[i].getAsFile()
    if (file) files.push(file)
  }
  if (files.length > 0) {
    event.preventDefault()
    enqueueFiles(files, '粘贴')
  }
})

// 输入路径 4:屏幕选区 / 原生文件通道(仅桌面版;浏览器无 Tauri IPC)
let lastRegionPngBase64 = ''
if (isTauri) {
  regionButton.hidden = false
  regionButton.addEventListener('click', () => {
    log('region', '发起屏幕选区')
    void invoke('start_capture').catch(err => {
      log('region', `start_capture 失败:${String(err)}`)
      flashToast('屏幕捕获失败')
    })
  })
  void listen<string>('region-captured', event => {
    lastRegionPngBase64 = event.payload
    log('region', `收到选区截图(base64 ${event.payload.length} 字符),进入识别管线`)
    const bin = atob(event.payload)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    enqueueFiles([new File([bytes], '屏幕选区.png', { type: 'image/png' })], '屏幕选区')
  })
  // 桌面拖拽:原生拖放事件携带文件完整路径,经 read_image_files 读回字节;高亮跟随 enter/leave
  void getCurrentWebview().onDragDropEvent(event => {
    const payload = event.payload
    if (payload.type === 'enter') {
      appRoot.classList.add('dragging')
    } else if (payload.type === 'drop') {
      appRoot.classList.remove('dragging')
      void handleImagePaths(payload.paths, '拖动')
    } else if (payload.type === 'leave') {
      appRoot.classList.remove('dragging')
    }
  })
}
