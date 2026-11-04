import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 产品身份守卫单测:双产品线共用同一份 conf 结构,跨行同步改动(如 CSP 修复)
 * 与身份字段相邻,曾把识别线的 productName/identifier/version 整块带进生成线,
 * 两线产品名与数据目录(com.offlineqr.*)串线。此处把身份一致性固化为单测,
 * 两条分支各自适用:productName 与 identifier 成对,版本三处一致。
 */

const conf = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf-8'),
) as { productName: string; version: string; identifier: string }

/** productName ↔ identifier 的合法成对关系( OfflineQR=全功能线,OfflineQRScanner=仅识别线) */
const IDENTITY: Record<string, string> = {
  OfflineQR: 'com.offlineqr.desktop',
  OfflineQRScanner: 'com.offlineqr.scanner',
}

describe('tauri.conf.json 产品身份守卫(两线不串)', () => {
  it('productName 与 identifier 成对匹配', () => {
    expect(IDENTITY[conf.productName]).toBe(conf.identifier)
  })

  it('版本三处一致(conf / package.json / Cargo.toml)', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as {
      version: string
    }
    const cargo = readFileSync(resolve(process.cwd(), 'src-tauri/Cargo.toml'), 'utf-8')
    const cargoVer = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1]
    expect(conf.version).toBe(pkg.version)
    expect(conf.version).toBe(cargoVer)
  })
})
