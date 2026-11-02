# 架构设计(Architecture)

> 版本:v1.0,2026-10-30 定稿。
> 实现若偏离本文档:先改文档并 commit,再改代码。

## 1. 总览

**同一套 Web 核心,两种交付形态:**

```
            ┌────────────────────────────┐
            │    前端核心(src/, TS)       │
            │    识别管线 + UI + 历史      │
            └──────────┬─────────┬───────┘
            vite build │         │ tauri build
        ┌──────────────▼──┐  ┌───▼───────────────┐
        │ dist/index.html │  │  Tauri 2 桌面应用   │
        │ (单文件,浏览器直开) │  │  (WebView2 壳)     │
        └─────────────────┘  └───────────────────┘
```

v1 无任何 Rust 业务逻辑:Rust 壳只负责窗口与打包;识别、历史、UI 全部在前端完成。后期如需原生能力(摄像头等)再扩展 Tauri command。

## 2. 技术栈与依赖

| 层 | 选型 | 许可 |
|---|---|---|
| UI | 原生 TypeScript + DOM(项目规模不需要框架;后期复杂化再评估) | — |
| 构建 | Vite + TypeScript | MIT |
| 识别引擎 | zxing-wasm(ZXing-C++ 官方 WASM 构建,npm 包名不带 scope) | Apache-2.0 |
| 桌面壳 | Tauri 2(窗口/打包/截屏命令) | MIT / Apache-2.0 |
| Rust 侧依赖 | screenshots(截屏)、image(png 编码)、base64 | MIT / Apache-2.0 |
| 前端 Tauri API | @tauri-apps/api(invoke/event/window) | MIT/APACHE-2.0 |
| 单文件产物 | vite-plugin-singlefile | MIT |
| 生成 | qrcode(矩阵生成)+ 自研 SVG 渲染器(样式化:形状/渐变/眼睛/Logo) | MIT |

注:jsQR 不采用(引擎决策记录于 task.md 2026-10-30);`qrcode` 库仅为测试依赖,后期生成模块转正式依赖。

## 3. 目录结构(规划)

```
E:\Project\QR
├── docs/                      需求/架构/UI 文档
│   ├── requirements.md
│   ├── architecture.md
│   └── ui-design.md
├── scripts/
│   └── gen-icon.mjs           应用图标生成(Node zlib 手写 PNG)
├── src/                       前端核心(TypeScript)
│   ├── main.ts                入口分发(主窗 / 屏幕选区遮罩窗)
│   ├── app.ts                 主窗装配(双 Tab 切换 + 识别面板 + region 事件)
│   ├── styles/style.css
│   ├── shared/                status(轻提示/进度)、url(链接判定)
│   ├── scanner/               识别管线(engine/worker/decode/ingest/queue/results/history)
│   ├── region/                屏幕选区(selection/crop 纯函数 + overlay 装配)
│   └── generator/             生成(matrix/style/render-svg/render-canvas/export/scancheck/panel)
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
├── src-tauri/                 Rust 壳(零业务代码)
│   ├── tauri.conf.json
│   ├── Cargo.toml
│   ├── build.rs
│   ├── src/{main.rs, lib.rs}
│   └── icons/
├── task.md                    进度跟踪(唯一)
└── AGENTS.md                  会话工作约定
```

## 4. 识别管线(核心数据流)

```
File / Blob
  → createImageBitmap(blob, { imageOrientation: 'from-image' })    // EXIF 方向
  → (Worker 内) 离屏 canvas 取 ImageData;长边 > 2048 先降采样
  → readBarcodes(imageData, { formats: ['QRCode'], tryHarder, tryRotate,
                               tryInvert, tryDownscale })
  → Barcode[](一图多码全部返回)
  → 主线程:结果卡片 / 历史
```

- **解码在 Web Worker**:Worker 以 `?worker&inline` 引入(构建期 base64 内联进产物,从设计上规避单文件模式下的分包问题);WASM 模块在 worker 内初始化一次并复用,主线程只做 UI,满足"批量不卡界面"。
- 输入统一抽象为 `ImageTask { id, bitmap, thumb }`,**队列串行**处理;单张失败不阻断队列。
- 解码参数固定开启 tryHarder / tryRotate / tryInvert / tryDownscale,以识别率为优先(延迟换准确)。

## 4a. 屏幕选区管线(桌面版专属)

```
主窗 [屏幕选区] 按钮(仅 __TAURI_INTERNALS__ 存在时显示)
  → invoke start_capture
      Rust: 隐藏主窗(主线程同步)+ 等待 DWM 重新合成(150ms,防残影)→ 截屏+快速 PNG 编码(Fast 压缩:
            默认压缩在 1080p 要数百毫秒,是弹出延迟大头)在后台线程并行执行,遮罩窗创建(隐藏)同时进行
      Rust: 截屏完成后按物理像素落位(set_position/set_size(Physical) → show)——混合 DPI 下逻辑换算有
            1.5 倍级错位,一律用物理像素;遮罩窗前端轮询 get_capture(3s 上限)直到数据就绪
      Rust: 每个显示器创建一个遮罩窗口 region-overlay-<i>(无边框置顶,按逻辑坐标定位,
            以 visible=false 隐藏创建——规避 Windows 开窗展开动画)
遮罩窗(main.ts 按窗口 label 序号进入 overlay 模式)
  → invoke get_capture(index) → 全屏显示该屏截图 + 十字光标 + 暗化
  → 拖拽出矩形(选区状态机,纯函数)
  → 松手:canvas 按图像像素裁剪 → toDataURL → invoke finish_capture(pngBase64)
  → Esc:invoke cancel_capture
  → 位图就绪:invoke show_overlay(index) → 窗口显示 + 180ms 淡入
Rust(finish/cancel):关闭全部遮罩;finish 额外 emit "region-captured"(pngBase64)
主窗 listen("region-captured") → base64 → File → 复用 enqueueFiles 识别管线
```

- 选区坐标换算(CSS px → 图像 px,含 DPI 缩放)与选区状态机均为纯函数,独立单测。
- 浏览器形态无 Tauri IPC:按钮隐藏;直接打开遮罩 URL 时降级为提示文案。
- 引擎侧兜底:单张解码超时(8s)或 Worker 异常终止时自动重建 Worker 并按失败落定,
  "识别中"状态必然终结(见 §5 engine 与 §9 风险表)。
- 交互:遮罩以 180ms 淡入呈现(截图位图就绪后触发),消除触发时的白闪。
- 裁剪源使用 `createImageBitmap(image)` 位图(而非 `<img>` 元素直接 drawImage),
  规避 WebView2 下元素位图的不确定性;仅接受 dataURL 源,无画布污染风险。
- 文件拖拽/选择双通道:浏览器走标准 HTML5 拖放与 input(拿不到文件路径,meta 只显示文件名);
  桌面端 Tauri 原生拖放会吞掉 HTML5 drop 事件,故改用 `getCurrentWebview().onDragDropEvent`
  (事件携带文件完整路径,高亮由 enter/leave 驱动),文件选择用原生对话框命令
  `pick_image_files`(tauri-plugin-dialog,Rust 侧调用,无能力项),路径经
  `read_image_files` 命令读回字节——WebView2 不向网页暴露文件路径,桌面端只能走原生通道。
- WebView2 默认禁用原生脚本对话框,`window.confirm/alert` 恒返回 false:
  破坏性操作(清空历史等)一律用应用内二次点击确认,不依赖原生对话框。
- 全局快捷键(`tauri-plugin-global-shortcut`,Rust 侧注册不占前端能力):
  `Alt+Q` 直接调用 start_capture 发起屏幕选区,`Alt+W` 主线程切换主窗显隐;
  注册失败(组合键被占用)仅记日志降级,不影响应用内按钮路径。

### 参考方案(开源截图/扫码工具调研,2026-11-01)

| 工具 | 多屏方案 | 借鉴点 |
|---|---|---|
| Flameshot | 每屏一个全屏遮罩窗,跨屏协调选择 | 与本项目方案一致;其历史痛点集中在混合 DPI 坐标映射(#4894/#4385) |
| ShareX | 冻结的整虚拟桌面合成位图 + 单一选区 UI | "冻结屏幕"防闪烁(本项目用静态截图垫底,等效) |
| ksnip | 全组合 + 逐屏两种捕获模式 | 混合分辨率下表现较好,可作为后期"整桌ation单选区"模式的参考 |

结论:逐屏遮罩是主流做法;三者的共同翻车点是混合 DPI 多屏——本项目遮罩窗几何统一使用
物理像素落位(隐藏创建 → set_position/set_size(Physical) → show):逻辑坐标经"窗口创建时
所在显示器"的缩放换算会产生 1.5 倍级错位(2K@150% 主屏 + FHD@100% 副屏实测),物理值与
显示器一一对应、无歧义;每屏 scale_factor 与实测视口写入日志便于定位。

### 诊断日志(2026-11-01)

- Rust:日志写入 `%LOCALAPPDATA%/…/app_local_data/logs/offlineqr-YYYYMMDD.log`,
  行格式 `[YYYY-MM-DD HH:MM:SS.mmm][rust] 消息`;截屏命令全链路埋点
  (显示器枚举、每屏截屏耗时与尺寸、遮罩窗创建、finish/cancel)。
- 前端:`shared/log.ts` 提供同格式日志(时间戳精确到毫秒),console 输出 + 缓冲批量
  经 `append_log` 命令写入同一文件(桌面形态;浏览器形态仅 console)。
- 用途:用户报告问题时提供日志文件,替代猜测式排查。

## 4b. 生成管线(recognition-generation 分支)

```
文本 + 纠错等级
  → generator/matrix.ts:QRCode.create → 矩阵 { size, data }
  → generator/render-svg.ts:矩阵 + QrStyle → SVG 字符串(纯函数)
      模块 path(方/圆角/圆点)· 三个定位角独立绘制(恒实心环)
      渐变 userSpaceOnUse(整体渐变而非逐模块)· Logo 区域挖孔 + <image>
  → 预览:inline SVG(矢量,任意缩放清晰)
导出 PNG:SVG → Image → canvas(导出尺寸可调)→ toBlob
导出 SVG:SVG 字符串直接 blob 下载
可扫性自检:固定 320px 栅格化 → ImageData → decodePixels(复用识别引擎)→ 徽章
```

- 渲染器为纯函数(矩阵+样式 → SVG 字符串),不触碰 DOM,可完整单测。
- 可扫性规则在渲染器内强制:定位角恒实心环、Logo 挖孔 + 尺寸上限、默认留白 4 模块。
- Logo 仅接受 dataURL(用户本地文件),避免 SVG 栅格化时的跨域画布污染。

## 4c. 内容模板与生成历史(recognition-generation 分支)

```
GenContent(text | wifi | vcard,表单状态)
  → content.ts:contentToText(纯函数)
      wifi → WIFI:T:WPA;S:…;P:…;H:true;;(\ ; , : " 转义;nopass 省略 P)
      vcard → vCard 3.0 文本(空字段省略,\r\n 行结束,, ; \ 与换行转义)
      无效输入(空 SSID/全空名片)→ null
  → 复用 4b 管线:矩阵 → renderQrSvg → 预览/导出/自检
生成历史(gen-history.ts):结构化条目(GenContent + 时间)存 localStorage
  记录时机:导出 PNG/SVG 或复制成功;按内容 JSON 去重置顶;点击条目恢复表单
```

## 5. 前端模块职责(原 §5)

| 模块 | 职责 |
|---|---|
| main.ts | 入口分发:按窗口 label/查询参数进入主窗或遮罩窗模式 |
| app.ts | 主窗装配:三种输入监听 → ingest → 队列 → 渲染 + region 事件接入 |
| region/selection.ts | 选区状态机(纯函数:归一化、最小尺寸判定) |
| region/crop.ts | CSS 选区 → 图像像素区域(纯函数:DPI 缩放、四舍五入、夹紧) |
| region/overlay.ts | 遮罩窗装配(canvas 绘制与指针事件,薄胶水层) |
| generator/matrix.ts | 文本 → QR 矩阵(纯封装,溢出抛错) |
| generator/style.ts | QrStyle 类型、默认样式与 5 个预设(纯) |
| generator/render-svg.ts | 矩阵 + 样式 → SVG 字符串(纯函数,核心渲染器) |
| generator/render-canvas.ts | SVG → canvas 栅格化(薄胶水) |
| generator/export.ts | PNG/SVG 下载与复制(薄胶水) |
| generator/scancheck.ts | 可扫性自检(复用 decodePixels) |
| generator/panel.ts | 生成面板装配(表单 ↔ 状态 ↔ 预览) |
| generator/content.ts | 内容模型与模板编码(GenContent → 文本,纯函数) |
| generator/gen-history.ts | 生成历史 store(结构化条目,localStorage) |
| scanner/decode.ts | zxing-wasm 纯封装:PixelData → texts,可独立单测 |
| scanner/engine.ts | Worker 生命周期与请求-响应封装;不可用时降级主线程解码 |
| scanner/worker.ts | WASM 初始化 + 单张解码 |
| scanner/ingest.ts | File/Blob → ImageBitmap(EXIF 方向)+ 64px 缩略图 |
| scanner/results.ts | 结果卡渲染、复制、打开链接、折叠展开 |
| scanner/history.ts | localStorage 读写、去重置顶、渲染 |
| shared/status.ts | 进度行与轻提示 |

## 6. 数据与存储

- 历史:`localStorage['qr.history.v1'] = [{ text, at }]`;同 text 置顶刷新时间;上限 20 条,超限淘汰最旧。
- 无其他持久化,无设置页。

## 7. 构建与形态差异

| 命令 | 用途 |
|---|---|
| `npm run dev` | vite dev server(localhost,日常开发) |
| `npm run build` | tsc 类型检查 + vite build + singlefile 内联 → `dist/index.html` |
| `npm run tauri dev` | 桌面窗口加载 dev server |
| `npm run tauri build` | NSIS 安装包 |
| `npm run smoke` | node 端识别管线自测 |

- Tauri conf:`frontendDist: ../dist`;CSP 仅本地源并允许 `wasm-unsafe-eval`;窗口规格见 UI 文档 §5。
- 形态差异:桌面版窗口即应用;单文件版 file:// 直开。
- **已知风险(随 #2 首次接入引擎时验证)**:file:// 下 WASM 实例化(Worker 内联已通过 `?worker&inline` 从设计上规避)。降级预案:WASM 走非 streaming 实例化;若 file:// 仍受限,单文件版注明需 localhost 访问,桌面版不受影响。

## 8. 测试策略(自动化优先)

原则:**应测尽测、可测性内建**;人工测试仅保留安装卸载等不可自动化项。

| 层 | 工具 | 覆盖内容 |
|---|---|---|
| 单元/组件 | Vitest + happy-dom | 历史去重/上限/清空、队列调度与错误隔离、URL 判定、结果卡片渲染、ingest 任务构建、状态提示 |
| 识别管线 | Vitest(node 环境,`qrcode` 生成样张) | 正常 / 缩放模糊 / 低量化抖动 / 反色 样张解码断言 |
| 选区数学 | Vitest | 选区状态机(归一化/最小尺寸)、CSS→图像坐标映射(DPI/夹紧) |
| 生成渲染器 | Vitest | 各形状 path/渐变 defs/眼睛独立配色/Logo 挖孔/留白 viewBox 断言 |
| 生成闭环 | Playwright E2E | 样式切换 → 导出 PNG → 回贴识别 Tab → 解码回读原文 |
| 内容模板 | Vitest + E2E | WIFI:/vCard 编码与转义(单测);导出回贴解码比对(E2E) |
| 生成历史 | Vitest + E2E | 去重/上限/清空/损坏容错(单测);恢复表单(E2E) |
| E2E | Playwright(Chromium) | 三条输入路径、多码展示、失败标注、历史回显、**零网络请求断言** |

**可测性设计约束**(编码时强制遵守):

1. 逻辑与 DOM 分离:历史、队列、URL 判定等均为纯函数/纯类
2. 副作用集中且可注入:localStorage、当前时间、计时器通过参数注入,测试可替换
3. 渲染函数式:`render(container, data)`,不依赖全局单例
4. 引擎单一边界:所有解码必经 `engine.ts`,mock 点唯一
5. DOM 断言使用 `data-testid`,禁止用样式/文案定位

覆盖率门禁:`vitest --coverage`,src 全局阈值 ≥ 80%(装配层 main.ts 与 worker.ts 除外)。

### 测试盲区与问题复盘(2026-11-01)

| 已发生问题 | 为什么测试没拦住 | 已补措施 |
|---|---|---|
| Windows 同步命令建窗死锁(v1.1.0) | Vitest/E2E 均运行在浏览器环境,Rust 事件循环不在覆盖范围 | 涉窗命令 async 规则入文档与风险表;诊断日志兜底定位 |
| 无码图"识别中"永挂(v1.2.0) | 假 Worker 未建模"Worker 静默死亡"场景 | 引擎超时/onerror 重建单测(engine.test.ts ×2) |
| 屏幕选区仅主屏(v1.2.0) | 多屏几何属 OS 层,单测不可达 | label 解析纯函数单测;逐屏几何写入日志;人工 smoke 清单 |
| 选区含码却报未识别(v1.2.0) | 区域截图裁剪链路无诊断,WebView2 行为差异不可预知 | 全链路日志(视口/DPR/尺寸/裁剪/回传);裁剪改 ImageBitmap;失败样张落盘 |
| 主窗"幽灵副本"进入截图(v1.2.1-dev) | 主窗 hide 为异步派发,截屏线程先行,像素取证证实幽灵为 35% 暗化副本 | 显隐改为主线程同步执行(run_on_main_thread + 标志位确认);遮罩黑色底全程不透明,仅淡入截图内容 |
| 主窗 hide 后截屏仍带"半透明残影"(v1.2.1-dev 复测) | hide 仅改窗口标志,DWM 下一合成帧才把窗口移出桌面画面,GDI BitBlt 取已合成帧;窗口标志/is_visible 无法感知合成时机,浏览器内自动化测试完全不可达 | hide 确认后固定等待 150ms(约 9 合成帧)再截屏;日志记录隐藏→截屏间隔,人工 smoke 验证 |
| 选区识别在内嵌资源构建全挂、dev 全绿(v1.2.1-dev) | CSP 仅生产(custom-protocol)构建注入,vitest/E2E 从不经过 CSP;CSP 缺 worker-src 时 Blob 内联 Worker 被拦,Worker 立即死亡 | CSP 约束固化为守卫单测(src/tauri-csp.test.ts:blob worker / wasm-unsafe-eval / img data:);发布前人工 smoke 必含"选区识别 + 粘贴识别";失败卡显示真实引擎错误 |
| 桌面端文件拖拽失效 / 清空历史无效(v1.2.1-dev) | WebView2 壳层行为(Tauri 原生拖放接管吞掉 HTML5 drop;原生脚本对话框禁用致 confirm 恒 false)在浏览器 E2E 中完全不可见 | 主窗 `dragDropEnabled: false` 走标准 HTML5 拖放;确认交互一律应用内二次点击,禁用 window.confirm;桌面 smoke 清单必含"拖拽图片 + 清空历史" |

结论:OS/窗口层以"结构化日志 + 人工 smoke 清单"兜底;纯逻辑一律补单测。

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| file:// 下 WASM 实例化受限 | 非 streaming 实例化;仍不行则单文件版注明 localhost 使用(Worker 内联风险已由 `?worker&inline` 从设计上规避) |
| @zxing/zxing-wasm API 与本文档有出入 | 以官方 README 为准,差异收敛在 engine.ts 一处适配 |
| 批量大图内存占用 | 队列串行 + ImageBitmap 即用即 close |
| 屏幕选区多显示器/高分屏 DPI 差异 | 逐屏遮罩 + 逻辑坐标定位(物理/缩放);混合缩放倍率场景需真机回归 |
| Tauri Windows 同步命令内创建窗口死锁 | 涉窗口操作命令一律 `async fn`(v1.1.1 修复:同步命令阻塞主线程事件循环会整窗无响应) |
| 解码后台静默挂起(Worker 异常等) | 引擎三重兜底:8s 超时终止重建 / Worker onerror 重建 / maxNumberOfSymbols 有界——"识别中"必然终结(v1.2.0) |
| 美化样式破坏可扫性 | 渲染器规则强制(实心眼环/挖孔/留白)+ 内置引擎实时试扫徽章 + E2E 闭环断言 |
| SVG 栅格化画布污染 | Logo 仅接受 dataURL;全资源本地内联 |
