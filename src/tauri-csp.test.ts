import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * CSP 守卫单测:tauri.conf.json 的 CSP 仅在打包产物(custom-protocol)构建中注入,
 * dev 模式与浏览器内自动化测试都不会加载它——曾因此漏检"内联 Worker 被 blob:
 * 限制拦截,选区识别全挂"(dev 全绿 ≠ release 可用)。此处把 CSP 约束固化为单测。
 */

const conf = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf-8'),
) as { app?: { security?: { csp?: string } } }

const csp = conf.app?.security?.csp ?? ''

/** 取某个 directive 的源列表(无该 directive 时返回空串) */
function directive(name: string): string {
  return (
    csp
      .split(';')
      .map(part => part.trim())
      .find(part => part.startsWith(`${name} `)) ?? ''
  )
}

describe('tauri.conf.json CSP 守卫(生产构建生效,测试环境不加载)', () => {
  it('允许 blob: 内联 Worker(worker-src 含 blob:,缺失时回退 script-src)', () => {
    // worker.ts 经 ?worker&inline 以 Blob URL 创建;worker-src 缺失时回退 script-src
    const source = directive('worker-src') || directive('script-src')
    expect(source).toContain('blob:')
  })

  it('script-src 含 wasm-unsafe-eval(Worker 内 WebAssembly.instantiate 需要)', () => {
    expect(directive('script-src')).toContain('wasm-unsafe-eval')
  })

  it('img-src 允许 data: 与 blob:(缩略图、选区回显、生成预览)', () => {
    const img = directive('img-src')
    expect(img).toContain('data:')
    expect(img).toContain('blob:')
  })

  it('connect-src 允许 data:(zxing-wasm 以 data URI 内联 wasm)', () => {
    expect(directive('connect-src')).toContain('data:')
  })

  it('connect-src 放行 ipc 通道(二进制 Response 的 fetch 传输被 CSP 拦截会让遮罩黑屏卡死)', () => {
    const connect = directive('connect-src')
    expect(connect).toContain('ipc:')
    expect(connect).toContain('http://ipc.localhost')
  })
})
