import { invoke } from '@tauri-apps/api/core'
import { log } from '../shared/log'
import { toImageRect } from './crop'
import { overlayIndexFromLabel, createSelection, type Rect } from './selection'

// 全局异常兜底:未捕获异常/未处理 Promise 拒绝进入诊断日志
window.addEventListener('error', event => log('window', `未捕获异常:${event.message}`))
window.addEventListener('unhandledrejection', event => log('window', `未处理的 Promise 拒绝:${String(event.reason)}`))

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

  // 取消通道先行注册:无论后续数据链路成功与否,右键/Esc 永远可以退出遮罩
  const cancel = (): void => {
    log('overlay', '取消选区(右键/Esc)')
    void invoke('cancel_capture').catch(() => {})
  }
  window.addEventListener('contextmenu', event => {
    event.preventDefault()
    cancel()
  })
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') cancel()
  })

  // 截屏在 Rust 侧与遮罩窗创建并行进行:轮询取原始 RGBA(二进制 IPC)直到就绪(最多 3s)
  let buf: ArrayBuffer | null = null
  const fetchT0 = performance.now()
  try {
    for (let tries = 0; tries < 60 && !buf; tries++) {
      buf = await invoke<ArrayBuffer>('get_capture_raw', { index })
      if (!buf || buf.byteLength <= 8) {
        buf = null
        await new Promise(r => setTimeout(r, 40))
      }
    }
  } catch (err) {
    log('overlay', `get_capture_raw 调用失败:${err instanceof Error ? err.message : String(err)}`)
  }

  const root = document.createElement('div')
  root.className = 'overlay'
  if (!buf) {
    // 取图失败:遮罩已不可用,关闭遮罩并恢复主窗(绝不让用户困在黑屏里)
    log('overlay', '无截屏数据(超时/失败),取消本次选区')
    cancel()
    return
  }

  // 载荷:宽度 u32 LE + 高度 u32 LE + RGBA 像素;零解码,putImageData 直上屏
  if (!(buf instanceof ArrayBuffer)) {
    log('overlay', `get_capture_raw 返回非 ArrayBuffer:${Object.prototype.toString.call(buf)}`)
  }
  const dv = new DataView(buf)
  const width = dv.getUint32(0, true)
  const height = dv.getUint32(4, true)
  const pixels = new Uint8ClampedArray(buf, 8)
  log('overlay', `截屏数据就绪(等待 ${Math.round(performance.now() - fetchT0)}ms):${width}x${height},原始 RGBA ${buf.byteLength} 字节`)

  const offscreen = new OffscreenCanvas(width, height)
  offscreen.getContext('2d')?.putImageData(new ImageData(pixels, width, height), 0, 0)
  const bitmap = await offscreen.transferToImageBitmap()

  const image = document.createElement('canvas')
  image.className = 'overlay-image'
  image.width = width
  image.height = height
  image.getContext('2d')!.drawImage(bitmap, 0, 0)

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
    const scale = width / window.innerWidth
    const imageRect = toImageRect(rect, scale, width, height)
    log(
      'overlay',
      `选区完成 CSS ${rect.width}x${rect.height} @(${rect.x},${rect.y}) → 图像 ${imageRect.width}x${imageRect.height} @(${imageRect.x},${imageRect.y}),scale=${scale.toFixed(3)}`,
    )
    if (imageRect.width < 2 || imageRect.height < 2) {
      log('overlay', '选区过小,按取消处理')
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
  window.addEventListener('resize', resize)

  resize()

  // 像素已直接上屏(canvas),淡入即可
  log('overlay', `遮罩就绪,累计 ${Math.round(performance.now() - t0)}ms,淡入显示`)
  requestAnimationFrame(() => root.classList.add('visible'))
}

void boot()
