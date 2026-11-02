import { invoke } from '@tauri-apps/api/core'
import { log } from '../shared/log'
import { toImageRect } from './crop'
import { overlayIndexFromLabel, createSelection, type Rect } from './selection'

// 全局异常兜底:未捕获异常/未处理 Promise 拒绝进入诊断日志
window.addEventListener('error', event => log('window', `未捕获异常:${event.message}`))
window.addEventListener('unhandledrejection', event => log('window', `未处理的 Promise 拒绝:${String(event.reason)}`))

interface CaptureData {
  width: number
  height: number
  png_base64: string
}

const MIN_SIZE = 4

/** 遮罩窗口按 label 序号(region-overlay-<i>)对应各自的截屏数据 */
async function resolveIndex(): Promise<number> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    return overlayIndexFromLabel(getCurrentWindow().label) ?? 0
  } catch {
    return 0
  }
}

/** 遮罩窗口:全屏显示截屏,拖拽选区后裁剪回传主窗 */
async function boot(): Promise<void> {
  // 双保险:移除静态应用 UI(head 脚本已按 label 隐藏),并记录关键样式状态
  document.querySelector('.app')?.remove()
  log(
    'overlay',
    `overlay-mode=${document.documentElement.classList.contains('overlay-mode')}, .app=${document.querySelector('.app') ? '仍在' : '已移除'}, 视口 ${window.innerWidth}x${window.innerHeight}, dpr=${window.devicePixelRatio}`,
  )
  const t0 = performance.now()
  const index = await resolveIndex()
  log('overlay', `启动:index=${index},视口 ${window.innerWidth}x${window.innerHeight},dpr=${window.devicePixelRatio}`)

  // 截屏在 Rust 侧与遮罩窗创建并行进行:轮询取图直到就绪(最多 3s)
  let data: CaptureData | null = null
  const fetchT0 = performance.now()
  try {
    for (let tries = 0; tries < 60 && !data; tries++) {
      data = await invoke<CaptureData | null>('get_capture', { index })
      if (!data) await new Promise(r => setTimeout(r, 50))
    }
  } catch (err) {
    log('overlay', `get_capture 调用失败:${err instanceof Error ? err.message : String(err)}`)
  }

  const root = document.createElement('div')
  root.className = 'overlay'
  if (!data) {
    log('overlay', '无截屏数据,降级为提示文案')
    root.classList.add('visible')
    root.textContent = '未获取到屏幕图像(请在应用内发起屏幕选区)'
    document.body.append(root)
    return
  }
  log('overlay', `截屏数据就绪(等待 ${Math.round(performance.now() - fetchT0)}ms):${data.width}x${data.height},base64 ${data.png_base64.length} 字符`)

  const image = document.createElement('img')
  image.className = 'overlay-image'
  image.alt = '屏幕截图'
  image.src = `data:image/png;base64,${data.png_base64}`

  const canvas = document.createElement('canvas')
  canvas.className = 'overlay-canvas'
  root.append(image, canvas)

  const hint = document.createElement('div')
  hint.className = 'overlay-hint'
  hint.textContent = '左键拖拽选区 · 右键取消 · Esc 取消'
  root.append(hint)
  document.body.append(root)

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    log('overlay', '无法创建画布上下文,取消选区')
    void invoke('cancel_capture').catch(() => {})
    return
  }

  const selection = createSelection(MIN_SIZE)
  let dpr = window.devicePixelRatio || 1
  let bitmap: ImageBitmap | null = null

  function redraw(): void {
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx!.clearRect(0, 0, window.innerWidth, window.innerHeight)
    ctx!.fillStyle = 'rgba(0, 0, 0, 0.35)'
    ctx!.fillRect(0, 0, window.innerWidth, window.innerHeight)
    const rect = selection.rect()
    if (rect) {
      ctx!.clearRect(rect.x, rect.y, rect.width, rect.height)
      ctx!.strokeStyle = '#818cf8'
      ctx!.lineWidth = 1.5
      ctx!.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1)
    }
  }

  function resize(): void {
    dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(window.innerWidth * dpr)
    canvas.height = Math.round(window.innerHeight * dpr)
    redraw()
  }

  async function finish(rect: Rect): Promise<void> {
    const current = data!
    const scale = current.width / window.innerWidth
    const imageRect = toImageRect(rect, scale, current.width, current.height)
    log(
      'overlay',
      `选区完成 CSS ${rect.width}x${rect.height} @(${rect.x},${rect.y}) → 图像 ${imageRect.width}x${imageRect.height} @(${imageRect.x},${imageRect.y}),scale=${scale.toFixed(3)}`,
    )
    if (imageRect.width < 2 || imageRect.height < 2) {
      log('overlay', '选区过小,按取消处理')
      void invoke('cancel_capture').catch(() => {})
      return
    }
    if (!bitmap) {
      log('overlay', '位图未就绪,按取消处理')
      void invoke('cancel_capture').catch(() => {})
      return
    }
    const crop = document.createElement('canvas')
    crop.width = imageRect.width
    crop.height = imageRect.height
    const cropCtx = crop.getContext('2d')
    if (!cropCtx) {
      void invoke('cancel_capture').catch(() => {})
      return
    }
    cropCtx.drawImage(bitmap, imageRect.x, imageRect.y, imageRect.width, imageRect.height, 0, 0, imageRect.width, imageRect.height)
    const dataUrl = crop.toDataURL('image/png')
    const pngBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    log('overlay', `裁剪 PNG ${imageRect.width}x${imageRect.height},base64 ${pngBase64.length} 字符,回传主窗`)
    try {
      await invoke('finish_capture', { pngBase64 })
      log('overlay', 'finish_capture 调用成功')
    } catch (err) {
      log('overlay', `finish_capture 失败:${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const point = (event: PointerEvent) => ({ x: event.clientX, y: event.clientY })

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return // 仅左键选区;右键留给取消
    canvas.setPointerCapture(event.pointerId)
    selection.begin(point(event))
    log('overlay', `开始选区 @${event.clientX},${event.clientY}`)
    redraw()
  })
  canvas.addEventListener('pointermove', event => {
    if (!selection.dragging) return
    selection.update(point(event))
    redraw()
  })
  canvas.addEventListener('pointerup', event => {
    if (event.button !== 0 || !selection.dragging) return
    selection.update(point(event))
    const rect = selection.end()
    redraw()
    if (rect) void finish(rect)
  })
  // 右键取消选区与识别
  window.addEventListener('contextmenu', event => {
    event.preventDefault()
    log('overlay', '右键取消选区')
    void invoke('cancel_capture').catch(() => {})
  })
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      log('overlay', 'Esc 取消选区')
      void invoke('cancel_capture').catch(() => {})
    }
  })
  window.addEventListener('resize', resize)

  resize()

  // 位图就绪后淡入截图内容(窗口本身创建即可见,首帧纯黑)
  try {
    await image.decode()
    bitmap = await createImageBitmap(image)
    resize()
    log('overlay', `截图解码完成,耗时 ${Math.round(performance.now() - t0)}ms,淡入显示`)
    requestAnimationFrame(() => root.classList.add('visible'))
  } catch (err) {
    log('overlay', `截图解码失败:${err instanceof Error ? err.message : String(err)}`)
    root.classList.add('visible')
  }
}

void boot()
