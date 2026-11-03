# QR 工具 · 任务跟踪(task.md)

> 本文档是本项目**唯一的**任务与进度跟踪入口。
> 规则:① 每完成一个特性/修复/文档,更新本文档并 commit;② 文档描述必须与实际实现保持一致;③ 需求、架构、UI 设计文档放在 docs/ 目录,本文档只做任务与进度索引。

## 项目定位

轻量、完全离线的二维码识别小工具。

- **平台策略**:Windows 优先开发与测试;Linux、macOS 为后期目标(桌面三端,不考虑移动端)
- **产品形态**:
  1. Tauri 2 桌面应用(主形态)
  2. 纯网页单文件版(`dist/index.html`,同一前端代码直接产出)
- **核心原则**:零网络请求,识别全部在本地完成,不上传任何数据
- **v1 策略**:**识别优先**——把二维码图片识别体验做到最好;生成模块整体后置

## 已定决策

| 日期 | 决策 | 结论 |
|---|---|---|
| 2026-10-29 | 平台 | Windows 先行,Linux/iOS 后期;要求保留三端通用的可能性 |
| 2026-10-30 | 技术栈 | Tauri 2(Rust 壳,零业务代码)+ Vite + TypeScript;构建产物同时含单文件 HTML |
| 2026-10-30 | 开发流程 | git 管理;每个特性/修复独立 commit;task.md 跟踪进度;文档与实现保持一致 |
| 2026-10-30 | **v1 范围** | **只做二维码识别(图片:选文件/拖拽/Ctrl+V 粘贴),识别体验做到最好;摄像头扫码与生成模块(配色/SVG/生成历史/Wi-Fi 模板)全部后期** |
| 2026-10-30 | 识别引擎 | zxing-wasm(识别率优先,支持一图多码;jsQR 弃用,qrcode 库仅作测试依赖) |
| 2026-10-30 | 批量与解析 | 支持多张批量识别;智能解析 v1 仅 URL + 纯文本 |
| 2026-10-30 | 平台修正 | 仅桌面端:Windows / Linux / macOS;不考虑 iOS 等移动端 |
| 2026-10-30 | 范围修正 | **摄像头扫码移出路线图(不做)**;全部功能先在 Windows 验证与打磨,完成后才适配 Linux/macOS |
| 2026-10-30 | 测试策略 | **自动化优先**:Vitest + happy-dom 单元/组件测试、qrcode 样张管线测试、Playwright E2E;覆盖率门禁 ≥80%;可测性设计约束见架构文档 §8 |

## 工作约定(每个会话必须遵守)

1. **控制与远程模型的交互频率**:减少轮次、批量执行工具调用、避免不必要的搜索与子代理(可能触发请求频率限制)。
2. **git 纪律**:每个特性开发、每个 bug 修复都必须有对应 commit,保证过程可追溯、可回溯。commit message 使用 `feat:` / `fix:` / `docs:` / `chore:` / `refactor:` 前缀。
3. **task.md 同步**:进度变化必须同步到本文档;发现文档与实现不一致,第一步是修齐文档。
4. **开发顺序**:需求文档 → 架构设计 → UI 设计 → 开发计划,全部定稿后再动手编码。
5. **影响面测试**:每次修改先评估影响面,只跑受影响模块的测试;**推送远程之前必须全量**(npm test + build + e2e)。
6. **Release 纪律**:release 版本不在本地编译;仅当用户明确要求发布时才打 tag 推送,触发远程 Release 构建。
7. **覆盖率复盘**:每个线上问题必须复盘"为什么测试没拦住",补对应测试或记入盲区清单(架构文档 §8)。

## 开发计划(commit 粒度)

| # | commit | 内容 | 状态 |
|---|---|---|---|
| 1 | `feat: project skeleton` | Tauri 2 + Vite 骨架、应用图标、可运行空壳;Vitest 测试基座(含首个示例测试) | ✔ 已完成(cargo check 通过;单文件产物 dist 仅 1 个 HTML) |
| 2 | `feat: recognition engine` | decode/engine/worker 接入 zxing-wasm;qrcode 样张管线测试(正常/低分辨率/低量化/反色/多码/空图)+ 引擎封装测试 | ✔ 已完成(17 项测试全过;wasm 内联打包验证随 #3 接线进行) |
| 3 | `feat: image ingestion` | 文件选择/拖拽/粘贴 → 串行队列;EXIF 方向、降采样、缩略图;ingest/queue 单元测试 | ✔ 已完成 |
| 4 | `feat: results UI` | results/status 渲染模块 + main 装配(三条输入路径→队列→引擎→卡片);渲染组件测试;浏览器实测粘贴识别通过;wasm 以 data URI 内联进单文件产物 | ✔ 已完成(39 项测试;浏览器端到端:粘贴→识别→卡片渲染,截图确认) |
| 5 | `feat: history` | 识别历史(去重置顶、上限 20、清空、回显);history 单元测试 | ✔ 已完成(46 项测试全过) |
| 6 | `feat: theme polish` | 深浅色、轻提示、空态、视觉细节 | ✔ 已并入 #4(CSS 与装配一次实现,浏览器截图确认) |
| 7 | `chore: desktop packaging` | NSIS 安装包构建通过 | ✔ 已完成(QrTool_0.1.0_x64-setup.exe,2.20 MiB;GitHub 下载超时已通过本地代理解决) |
| 8 | `test: e2e verification` | Playwright E2E + 需求 §7 验收清单核对 | ✔ 已完成(9 项 E2E 全过,含 file:// 直开与零网络断言) |
| 9 | `feat: screen region capture` | 屏幕选区识别:Rust 截屏命令(screenshots crate)+ 全屏遮罩选区窗 + 裁剪回传复用识别管线;选区状态机/坐标映射单测 | ✔ 已完成(56 项单测 + 9 项 E2E;真机截屏体验列入人工验证) |
| 10 | `feat: qr generation with deep styling` | 生成功能第一批:自研 SVG 渲染器(模块形状/独立眼形配色/渐变/Logo 挖孔/透明底/预设)+ 可扫性自检徽章 + PNG/SVG/复制导出 + 生成→导出→回贴识别 E2E 闭环 | ✔ 已完成(69 项单测 + 17 项 E2E 全绿) |
| 11 | `feat: content templates and generation history` | 生成第二批:Wi-Fi/vCard 内容模板(标准格式与转义纯函数)+ 生成历史(结构化条目、恢复表单);闭环 E2E 解码比对 | ✔ 已完成(90 项单测 + 22 项 E2E 全绿) |
| 12 | `fix: multi-monitor region capture and decode hardening` | 人工反馈两项修复:① 无码图卡"识别中"→ 引擎三重兜底(8s 超时终止重建/onerror 重建/maxNumberOfSymbols 有界);② 屏幕选区仅主屏 → 逐屏截屏+每屏一个遮罩窗(逻辑坐标定位) | ✔ 已完成(92 项单测 + 22 项 E2E 全绿;出 v1.2.0) |
| 13 | `feat: structured logging` + `fix: region decode diagnostics and fade-in` | 日志系统(Rust 文件日志 + 前端 ms 时间戳日志,统一写入本地文件);屏幕选区淡入 + 裁剪改 ImageBitmap + 全链路诊断日志 | ✔ 已完成 |
| 14 | `fix: region overlay presentation polish` | 人工反馈:① 遮罩弹出时紫色窗口展开动画 → 遮罩窗以 visible=false 隐藏创建,前端位图就绪后 show_overlay 显示 + 淡入;② 多屏截屏并行化;③ 像素取证发现主窗幽灵副本竞态(hide 异步派发先于截屏)→ 有序确认后再截屏,遮罩黑底不透明仅淡入截图;④ 主窗截屏期间隐藏,避免污染选区画面;⑤ 选区四周自动垫 24px 白色静区 + 失败卡文案引导确认选区完整;⑥ 根因三:带 State 的 async 命令在主线程执行 → run_on_main_thread 自死锁 500ms + 截屏期间 UI 冻结 → 命令改用 app.state 内部访问真正脱离主线程;⑦ 遮罩底图"半透明主窗"残影 → 根因:hide 确认后 0ms 即截屏,GDI BitBlt 取的是 DWM 重新合成前的旧桌面帧 → 隐藏确认后固定等待 150ms(约 9 合成帧)再截屏;⑧ 内嵌资源构建下选区识别全挂("识别引擎异常终止")→ 根因:CSP 无 worker-src,`?worker&inline` 的 Blob Worker 被 script-src 'self' 拦截(CSP 仅生产构建注入,dev 无 CSP 故自动化测试从未暴露)→ CSP 加 `worker-src 'self' blob:` + CSP 守卫单测,失败卡贯通真实原因不再误导 | ✔ 已完成(97 单测 + 22 E2E;全量门禁待推送前执行;debug 版可复测) |
| 15 | `refactor: copy-only cards` + `fix: html5 drag-drop` + `fix: in-app confirm` | 三项人工反馈:① 结果卡移除"打开链接",仅保留复制(isHttpUrl 模块删除);② 桌面端无法拖图 → Tauri 原生拖放接管吞掉 HTML5 drop 事件 → 主窗 `dragDropEnabled: false` 走标准 HTML5 拖放;③ 清空历史无效 → WebView2 禁用原生脚本对话框,window.confirm 恒 false(清空从未执行)→ 应用内二次点击确认(3s 自动解除),识别/生成历史同改,E2E 更新为双击清空;④ 记录交互理顺:清空识别历史同步清空结果卡片区(用户所指"上方的识别历史"),在途识别结果作废不再写回历史,历史面板点击外部/条目回显后自动收起,生成面板同改 |
| 16 | `feat: wintab-inspired dark theme` | 人工反馈"优化界面布局,参考 WinTab 配色"(E:\Project\WinTab):整体重写样式令牌——中性暗色基底(#0B0C0F / #12141A / #0D0F14)+ 单一强调色黑绿 #35D07A(实心主按钮配深色文字 #04240F、激活态淡染 + inset 描边),圆角 4/6/8px 与 140ms 动效阶梯沿用 WinTab;恒暗色,移除 prefers-color-scheme 双主题;顶栏加分隔线,卡片/预览阴影统一;ui-design.md 升 v1.4 | ✔ 已完成(纯样式层,测试无影响;视觉待 exe 人工确认) |
| 17 | `feat: dual-theme + card redesign + global shortcuts` | 五项人工反馈:① 配色系统照搬 WinTab/WinHop 双主题(黑绿默认/黑黄,中性基底共享只换 accent),顶栏一键切换 + localStorage 持久化 + 首帧前内联应用;② 最新识别结果着重显示(accent 描边 + "最新"徽标);③ 识别文本独立底色块 + 全选按钮(Range/Selection API 选中可 Ctrl+C);④ 复制按钮右置为强调色实心小按钮(每条文本独立一行);⑤ 全局快捷键 Alt+Q 屏幕选区 / Alt+W 显隐主窗(tauri-plugin-global-shortcut,Rust 侧注册,冲突降级记日志) | ✔ 已完成(95 单测 + 24 E2E 全绿;快捷键与视觉待 exe 人工确认) |
| 18 | `feat: result card polish` | 二轮卡片反馈:① 移除全选按钮,文本块原生可选(拖选部分/三击全选),长文本改单向展开避免与拖选冲突;② 识别完成默认全选文本块(Selection API);③ 文本块高度撑满卡片上下;④ 最新完成卡片移到列表最前;⑤ 卡片 meta 行标注来源(屏幕选区/文件/拖动/粘贴/历史回显)+ 年-月-日 时:分:秒 | ✔ 已完成(单测 + 24 E2E 全绿;待 exe 人工复测) |
| 19 | `refactor: card layout alignment` | 三轮卡片布局反馈:① 文本默认单行省略、卡片等高(点击展开/点外收起);② 缩略图垂直居中,上下间距一致;③ 复制按钮等高于文本框;④ meta 行"时间 · 来源 · 最新",徽标殿后,前缀信息跨卡片对齐 | ✔ 已完成(98 单测 + 24 E2E 全绿;待 exe 人工复测) |
| 20 | `refactor: remove scan history bar` | 三轮人工反馈:① 缩略图改拉伸对齐(上缘贴 meta、下缘贴文本块,cover 轻裁不变形);② 识别 Tab 移除底部"最近识别/清空/历史面板"(结果卡片区即历史,删除 history store 与相关交互,生成 Tab 保留);③ 屏幕选区按钮升级为与选择图片一致的强调色实心 | ✔ 已完成(单测 + 24 E2E 全绿;待 exe 人工复测) |
| 21 | `feat: square thumb + source file path` | ① 缩略图拉伸对齐后保持正方形(aspect-ratio:1,宽度随高度);② 文件/拖动来源显示完整源文件路径:WebView2 不向网页暴露路径 → 桌面端文件选择改原生对话框(pick_image_files,tauri-plugin-dialog Rust 侧调用)、拖拽改原生拖放事件(onDragDropEvent,enter/leave 驱动高亮),新增 read_image_files 按路径读图;浏览器端保留 HTML5 流程(仅文件名);meta 行超长路径省略号 + title 悬停全文;scanner/history 恢复为生成历史共享模块 | ✔ 已完成(单测 + 23 E2E 全绿;桌面路径链路待 exe 人工复测) |
| 22 | `refactor: latest highlight only + clear in toolbar` | ① "最新"徽标移除,仅保留卡片边缘强调色高亮;② 缩略图正方形修复:aspect-ratio 在 flex stretch 下对 img 不传递 → 改外层 div + JS 显式同步宽度=高度(渲染/展开/切 Tab 后触发);③ 清空按钮回归:工具条最右侧(与按钮簇隔离),二次确认,无记录隐藏 | ✔ 已完成(单测 + 24 E2E 全绿;待 exe 人工复测) |
| 23 | `refactor: standalone clear card` | 清空按钮改独立红色实心卡片:移出功能工具条,同行最右侧等高圆角矩形(danger #FF6B6B + 白字,不随主题),与左侧卡片隔离;二次确认交互不变 | ✔ 已完成(单测 + 24 E2E 全绿;待 exe 人工复测) |
| 24 | `feat: frameless rounded window` | 整窗圆角(Win10 无 DWM 圆角):无边框 + 透明窗,网页层画 10px 圆角/描边/阴影,四周 6px 透明边;自绘标题栏(data-tauri-drag-region 拖拽/双击最大化)+ 自绘最小化/最大化/关闭(关闭悬停危险色);构建标记经 build_info 命令移入自绘标题栏;最大化去圆角贴合屏幕;遮罩窗不受影响 | ✘ 已回退(实测不佳,恢复原生边框;实验代码见 6d6bec6/74bb149 与回退提交) |
| 25 | `chore: rename product OfflineQR` | 工具改名 OfflineQR,界面标题改"极简二维码":productName/identifier(应用数据目录随之更替)、窗口与任务栏标题、index.html 标题与 h1、E2E 标题选择器、绿色版脚本(产物名 OfflineQR.exe,兼容新旧 release 产物名)、Release 工作流名称、README/需求文档命名说明;Cargo/npm 包名保持 qr-tool 不变(debug exe 路径稳定) | ✔ 已完成(98 单测 + 24 E2E 全绿) |
| 26 | `chore: rename internals to offlineqr` | 对内改名:Cargo 包名 qr-tool → offlineqr、二进制 OfflineQR.exe(debug 与 release 产物名统一)、lib offlineqr_lib、npm 包名 offlineqr(含 lock)、日志文件 offlineqr-YYYYMMDD.log、绿色版/CI 绿色版 zip 名 OfflineQR_*、E2E 样例 URL;旧日志文件保留可回溯 | ✔ 已完成(98 单测 + 24 E2E 全绿) |
| 27 | `feat: brand icon A-finder` | 图标定稿候选 A「定位角」(黑白灰银,与 recognition 精简线同款):1024 源图逐像素绘制,`tauri icon` 派生全平台尺寸;favicon 同步;B(扫描线)/E(矩阵渐隐)备选存档 docs/design/icons/ | ✔ 已完成 |
| 28 | `fix: physical-pixel overlay geometry` | 第三方反馈 2K 屏选区遮罩放大 1.5 倍遮挡邻屏:混合 DPI 下遮罩窗逻辑坐标经"窗口创建时所在显示器"的缩放换算(主屏 2K@150% 时副屏遮罩放大 1.5 倍);遮罩窗几何全面改物理像素——隐藏创建 → set_position/set_size(Physical) 落位 → show,每屏 scale_factor 与实测 inner_size 入日志;100% 单一缩放环境行为不变 | ✔ 已完成(待混合 DPI 真机复测) |
| 30 | `perf: raw rgba binary ipc` | 取图链路去 PNG 化:截屏保留原始 RGBA → 二进制 IPC(tauri::ipc::Response)直传遮罩窗 → putImageData 直上屏。免 PNG 编码/解码与 base64/JSON(实测占弹出延迟 ~0.8s);2K 屏与 1080p 的差距缩小到传输体积差 | ✔ 已完成(待实测计时) |
| 29 | `perf: parallel capture and fast png` | 弹出耗时优化(1080p×2 日志实测 ~1.7s):① PNG 编码换 Fast 压缩+无滤镜(默认压缩 ~1.1s 是大头);② 截屏线程与遮罩窗创建(隐藏)并行、遮罩前端轮询取图(3s 上限),就绪即物理落位显示;启动失败回滚:关闭隐藏遮罩 + 恢复主窗 | ✔ 已完成(待实测计时) |
| 30 | `feat: right-click cancel in overlay` | 遮罩上右键取消选区与识别(左键拖拽选区不受影响:pointerdown/up 增加 button 校验,防右键误触发拖拽);遮罩底部加操作提示条(左键拖拽 · 右键取消 · Esc 取消) | ✔ 已完成(待实测) |
| 32 | `fix: card height and caret polish` | 卡片收起后高度不回落(缩略图内联宽度经图片固有比例把高度钉死)→ 缩略图改固定 64×64、与卡片高度彻底解耦(移除 syncThumbWidths 调用);展开态高度封顶 220px 滚动(长文本不再撑成巨物);文本块 contenteditable=plaintext-only + beforeinput 拦截 → 点击位置显示闪烁光标、可拖选复制但内容不可修改 | ✔ 已完成(待实测) |
| 31 | `fix: ipc csp + overlay fail-safe` | 二进制 Response 被 CSP 拦截(connect-src 缺 ipc 通道)→ 遮罩黑屏且取消处理器未挂载;修复:CSP 放行 ipc 通道 + 守卫单测;取消处理器先行注册;取图失败兜底 cancel_capture 恢复主窗 | ✔ 已完成(待实测) |
| 31 | `fix: restore main window after capture when minimized` | 最小化状态下 Alt+Q 选区识别完成后主窗不弹出:Win32 SW_SHOW 不会还原最小化窗口 → 新增 restore_main_window(unminimize + show + set_focus),finish 与启动失败回滚均走它;Alt+W 最小化时改为还原+聚焦 | ✔ 已完成(待实测) |

每步完成后:勾选下方对应任务 + 更新本表状态 + commit。

## 分支策略(2026-10-30 起)

- **`v1.0.0` tag**:识别功能完整基线(图片识别 + 屏幕选区 + 历史;56 单测 + 9 E2E)
- **`recognition` 分支**:只有识别功能,**识别独立迭代线**——识别相关修复与体验优化在此进行并独立发布
- **`recognition-generation` 分支**:识别 + 生成,**生成功能开发线**——生成模块(含配色/SVG/模板/生成历史)在此分支按既有流程(需求→设计→实现)开发
- `main`:基线冻结点,作为两条线的共同祖先与合流参考
- 约定:在任一分支工作时,以该分支上的 task.md 为准继续同步进度;commit 纪律与工作约定不变

## CI / CD(待远程仓库创建后验证)

- `.github/workflows/ci.yml`:push / PR(main、recognition、recognition-generation)→ 单测 + 构建 + E2E(ubuntu,前端不需要 Rust)
- `.github/workflows/release.yml`:推送 `v*` tag → 三平台矩阵构建(Windows NSIS / Linux AppImage+deb / macOS dmg)→ tauri-action 自动创建 Release;含 tag↔version 一致性守卫
- 已同步到两条迭代分支(recognition 分支 cherry-pick);创建远程后 `git push origin main v1.0.0 recognition recognition-generation` 即触发验证

## 人工测试样张(2026-10-31)

- `scripts/gen-test-fixtures.mjs` 生成 13 张覆盖性样张至 `test_picture/fixtures/`:文本/中文/长文/Wi-Fi 转义/vCard/一图多码/低质量/反色/圆点彩色/小尺寸/Logo 图
- `npm run fixtures` 重新生成;`npm run verify:fixtures` 自动 QA 门禁(引擎回读,13/13 通过)
- 附人工测试清单 `test_picture/fixtures/index.md`;用户自己的截图放 `test_picture/` 根目录,互不干扰

## Windows 绿色版(2026-10-31)

- `scripts/make-portable.mjs`(`npm run portable`):单 exe(静态链接 WebView2Loader,零 dll 依赖)+ 使用说明 → zip,输出至 `src-tauri/target/release/bundle/portable/`
- Release 工作流 Windows 任务已接入:每次发 tag 自动把绿色版 zip 上传到 Release 页
- 历史数据存于当前用户 WebView2 数据目录,不随 exe 迁移(使用说明中已注明)

## 阶段与任务

### Phase 0 · 需求与设计
- [x] 技术选型调研与确认(Tauri 2)
- [x] 需求方向讨论:v1 识别优先,生成与摄像头后置
- [x] 关键决策定稿:@zxing/wasm / 多张批量 / URL+文本
- [x] docs/requirements.md 需求文档
- [x] docs/architecture.md 架构设计文档
- [x] docs/ui-design.md UI 设计文档
- [x] 开发计划定稿(见上方"开发计划")

### Phase 1 · 项目骨架
- [x] git 仓库初始化
- [x] 计划 #1:骨架 + Vitest 测试基座(单文件构建通过、6 项单测通过、cargo check 通过)

### Phase 2 · 识别核心(基线完成)
- [x] 计划 #2:识别引擎(zxing-wasm)+ 样张管线测试
- [x] 计划 #3:输入路径与队列(ingest/queue 模块 + 单元测试)
- [x] 计划 #4:结果 UI 与 main 装配(浏览器实测通过;wasm 内联打包验证通过;file:// 行为级验证放入 #8)
- [x] 计划 #5:识别历史
- [x] 计划 #6:视觉打磨(并入 #4 完成)

### Phase 2g · 生成功能(recognition-generation 分支)
- [x] 计划 #10:生成第一批——深度自定义与美化(模块形状/眼睛/渐变/Logo 挖孔/透明底/预设/导出/可扫性自检)
- [x] 计划 #11:内容模板(Wi-Fi/vCard)与生成历史
- [x] 批次完成:bump 1.1.0 + tag v1.1.0 + 重打安装包

### Phase 3 · 桌面壳与打包
- [x] 计划 #7:NSIS 安装包(基线 2.33 MiB;v1.1.0 重打)

### Phase 4 · 验证
- [x] 计划 #8:E2E + 验收清单自动化覆盖
- [ ] 唯一剩余人工项:NSIS 安装包安装/卸载体验(双击 QrTool_1.1.0_x64-setup.exe)

### 后期(不在当前范围)
- [ ] 屏幕选区增强:全局快捷键、跨屏连续单次拖选
- [ ] Linux 适配
- [ ] macOS 适配(构建需 macOS 环境或 CI macOS runner)
- [ ] CI Release 修复:Linux/macOS 构建任务自 v1.1.0 起始终失败(Windows 全通);失败原因待取——Actions 页任务日志,或重跑触发已上线的失败日志构件功能(v1.2.0 起 workflow 已带自诊断)

## 变更记录

- 2026-10-30 初始化本文档;git 仓库建立;技术栈定为 Tauri 2。
- 2026-10-30 v1 范围定向:识别优先、生成与摄像头后置。
- 2026-10-30 关键决策定稿(@zxing/wasm、多张批量、URL+文本);需求/架构/UI 三份文档 v1.0 定稿;开发计划确定。
- 2026-10-30 平台修正:目标平台收敛为桌面三端(Windows/Linux/macOS),移除 iOS。
- 2026-10-30 摄像头扫码移出路线图;验证顺序定为 Windows 先行;确立自动化测试策略(可测性内建,应测尽测)。
- 2026-10-30 计划 #1 完成:Tauri 2 + Vite 骨架、图标、Vitest 基座;cargo check 通过;单文件产物验证 OK;识别引擎 npm 包名修正为 zxing-wasm。
- 2026-10-30 计划 #2 完成:decode/engine/worker 三层管线;17 项自动化测试(含真实 wasm 解码样张:常规/中文/低分辨率/低量化/反色/一图多码/空图)。
- 2026-10-30 计划 #3、#4 完成:ingest/queue/results/status 模块 + main 装配;39 项测试全过;浏览器实测粘贴识别链路成功(Worker + WASM + UI);单文件产物 1.31 MB,wasm 内联确认。
- 2026-10-30 计划 #5 完成:识别历史(去重置顶/上限/清空/回显),46 项测试全过;计划 #6 并入 #4;启动 #7 NSIS 打包。
- 2026-10-30 **v1 全部 8 步计划完成**:46 项单测 + 9 项 E2E 全绿;NSIS 安装包 2.20 MiB;file:// 直开与零网络请求均自动化验证;剩余唯一人工项为安装/卸载体验。
- 2026-10-30 UI 重设计(v1.1):紧凑小窗口(720×540)密度优先布局——一行式输入条、主内容区充满并内部滚动、历史上浮面板、移除页脚;46 单测 + 9 E2E 回归全过;安装包重打同步新界面。
- 2026-10-30 计划 #9 屏幕选区识别完成:FR-7 落地(Rust 截屏 + 遮罩选区 + 管线复用),选区数学纯函数单测;56 单测 + 9 E2E 全绿;真机截屏体验待人工验证。
- 2026-10-30 版本升至 **v1.0.0** 并打 tag;建立双迭代分支:`recognition`(仅识别)与 `recognition-generation`(识别+生成),main 冻结为基线参考。
- 2026-10-30 计划 #10 生成第一批完成:双 Tab + 自研 SVG 渲染器(形状/渐变/眼睛配色/Logo 挖孔/透明底/5 预设)+ 可扫性自检 + 导出闭环;过程中修复"透明像素等同纯黑"(检测与识别路径垫白底)与"Logo 需 H 级纠错"(自动升级);69 单测 + 17 E2E 全绿。下一批:内容模板与生成历史。
- 2026-10-30 配置 GitHub Actions:CI(push/PR 测试)与 Release(tag → 三平台产物)两套工作流,同步至两条迭代分支;待远程仓库创建后验证。
- 2026-10-30 计划 #11 完成:Wi-Fi/vCard 内容模板(标准格式与转义)+ 生成历史(结构化条目、恢复表单);90 单测 + 22 E2E 全绿。版本升至 **v1.1.0** 并打 tag,安装包重打。
- 2026-11-01 根因三(人工反馈):带 State 的 async 命令在主线程执行,导致 run_on_main_thread 自死锁 500ms + 截屏期间 UI 冻结 + 主窗隐藏失效;全部截屏命令改用 app.state 内部访问。
- 2026-10-31 新增人工测试样张:`scripts/gen-test-fixtures.mjs` + `verify-fixtures.mjs`(13 张样张,引擎回读 QA 全过);AGENTS.md 技术栈描述修正为 zxing-wasm。
- 2026-10-31 **fix:屏幕选区在主屏死锁**(人工测试发现)——根因:Tauri 在 Windows 上于同步 command 内创建窗口会死锁事件循环;四个截屏命令改为 async,遮罩窗口加黑色底色;出 v1.1.1。
- 2026-11-01 人工反馈修复:① 无码图卡"识别中"→ 引擎三重兜底(8s 超时终止重建 Worker / onerror 自动重建 / maxNumberOfSymbols=8 有界),92 单测含超时与重建用例;② 屏幕选区仅主屏:逐屏截屏 + 每屏一个遮罩窗(label 序号对应,逻辑坐标定位),全部屏幕均可独立框选。
- 2026-11-01 **fix:遮罩底图主窗"半透明"残影**(人工反馈复测)——日志时间线证实主窗 hide 成功(10ms 内确认)但随后 0ms 即截屏;GDI 全屏截图取的是 DWM 已合成帧,旧帧仍含主窗,遮罩窗全屏展示该底图时主窗以半透明残影出现(非活窗口)。修复:隐藏确认后固定等待 150ms(约 9 合成帧)再截屏。评估过"最小化"替代方案:SW_MINIMIZE 含 ~200ms DWM 动画,截图必带动画残影,予以否决;采用 Flameshot/Snipaste 同款"隐藏→等合成→截屏"。附带:debug 测试版改为内嵌前端资源构建(`cargo build --features tauri/custom-protocol`),不再依赖 dev server,杜绝"debug 版无法启动(localhost 拒绝连接)"类环境问题。**用户复测:残影已解决。**
- 2026-11-01 **fix:内嵌资源构建下选区识别全挂("识别引擎异常终止")**(人工反馈)——失败样张为完整清晰二维码,位图就绪后 1~2ms 即失败,排除裁剪与超时路径;根因:`tauri.conf.json` CSP 无 `worker-src`,`?worker&inline` 的 Blob Worker 被 `script-src 'self'` 拦截;**CSP 仅生产(custom-protocol)构建注入,dev 模式无 CSP,此前全部测试都在 dev 环境,故从未暴露**。修复:CSP 增加 `worker-src 'self' blob:`;新增 CSP 守卫单测(src/tauri-csp.test.ts ×4,固化 blob worker/wasm-unsafe-eval/img data: 约束);识别失败卡贯通真实原因(`识别异常:<error>`),不再一律显示"请确认选区完整"误导文案。**用户复测:选区识别恢复。**
- 2026-11-01 积压 commit 推送远程(3856d4b..edb6b67,推送前全量门禁:98 单测 + build + 22 E2E 全绿)。
- 2026-11-01 三项人工反馈优化:① 结果卡移除"打开链接"(仅复制),删除 isHttpUrl 死代码;② 桌面端拖拽失效根因:Tauri 窗口默认原生拖放接管(dragDropEnabled)拦截 Explorer 拖入,HTML5 drop 不触发 → 主窗配置 `dragDropEnabled: false`(浏览器/E2E 一直正常正是其特征);③ 清空历史无效根因:WebView2 默认禁用原生脚本对话框,`window.confirm` 恒 false → 清空从未执行 → 改为应用内二次点击确认(3s 自动解除),识别与生成历史同步修复,E2E 更新为双击清空。
- 2026-11-01 记录交互理顺(人工反馈):清空识别历史后,结果卡片区(用户所指"上方的识别历史")仍保留 → 清空时与历史一并清空并回到空态,在途识别结果作废不再写回历史(itemsEpoch 纪元机制);识别/生成历史面板支持点击外部自动收起、条目回显/恢复后自动收起。
- 2026-11-01 界面视觉重定(人工反馈:参考 E:\Project\WinTab 配色):样式令牌整体重写——中性暗色基底(#0B0C0F/#12141A/#0D0F14,文字 #E8EBF1/#9AA3B5/#5B6475)+ 单一强调色黑绿 #35D07A(on-accent #04240F、accent-strong #48E08C),错误 #FF6B6B;激活态统一"淡染 + inset 描边";圆角 4/6/8px、动效 140ms、Segoe UI/YaHei 字体栈、Consolas 等宽;恒暗色(移除浅色主题与 prefers-color-scheme 切换);ui-design.md 升 v1.4 并补记清空/面板交互规格。
- 2026-11-01 五项人工反馈(①配色系统 ②最新结果着重 ③文本块与全选 ④复制右置 ⑤全局快捷键):双主题黑绿/黑黄照搬 WinTab;结果卡片每条文本独立底色块 + 右侧全选/复制;最新完成卡片 accent 描边 + "最新"徽标;新增 tauri-plugin-global-shortcut 依赖,Alt+Q 任意应用下直接屏幕选区、Alt+W 显隐主窗,注册冲突降级记日志;95 单测 + 24 E2E(新增主题切换与全选/最新强调用例)。
- 2026-11-01 卡片二轮打磨(人工反馈):移除全选按钮改文本块原生可选(长文本单向展开防拖选冲突);识别完成默认全选文本块;文本块撑满卡片高度;最新完成卡片置顶;新增卡片 meta 行(来源 + 年月日 时:分:秒,来源含屏幕选区/文件/拖动/粘贴/历史回显,enqueueFiles 增加 source 参数)。
- 2026-11-01 卡片三轮微调(人工反馈):长文本展开后点击文本块外任意位置收起(pointerdown 统一处理);光标在文本块内时 Ctrl+A 只选中该块内容(keydown 捕获拦截整页全选),块外保持默认。
- 2026-11-01 卡片四轮布局对齐(人工反馈):文本默认单行省略(卡片等高,点击展开/点外收起);缩略图垂直居中使上下间距一致;复制按钮等高于文本框;meta 行改为"时间 · 来源 · 最新"顺序(徽标殿后,前缀信息跨卡片对齐)。
- 2026-11-01 界面三轮收尾(人工反馈):缩略图改拉伸对齐(上缘贴 meta、下缘贴文本块);识别 Tab 移除"最近识别"底部条与识别历史存储(history.ts 删除,结果卡片区即历史;生成 Tab"最近生成"保留);屏幕选区按钮与选择图片按钮同为强调色实心。
- 2026-11-01 缩略图方形 + 源文件路径(人工反馈):拉伸对齐后缩略图以 aspect-ratio:1 保持正方形;文件/拖动来源显示完整路径——WebView2 不向网页暴露路径,桌面端改原生通道(文件选择 = pick_image_files 原生对话框命令,拖拽 = onDragDropEvent 原生事件,新增 tauri-plugin-dialog 依赖与 read_image_files 读图命令),浏览器端保留 HTML5 流程;meta 行路径超长省略 + title 悬停全文。
- 2026-11-01 卡片五轮微调(人工反馈):"最新"徽标移除仅留边缘高亮;缩略图正方形修复(aspect-ratio 对 flex stretch 的 img 不传递 → 外层 div + JS 同步宽度=高度,展开/切 Tab 后重同步);清空按钮回归至工具条最右侧(二次确认,与卡片历史共存)。
- 2026-11-01 清空按钮独立卡片化(人工反馈):移出功能工具条,改为同行最右侧的独立红色实心圆角卡片(danger #FF6B6B + 白字),与左侧功能卡片等高隔离;二次确认交互不变。用户回到本机,后续以 exe 实测为准,不再走浏览器预览截图。
- 2026-11-01 整窗圆角(人工反馈):Win10 无 DWM 圆角,采用无边框 + 透明窗 + 网页层圆角方案(decorations:false / transparent:true);自绘标题栏(拖拽、双击最大化)与最小化/最大化/关闭按钮,构建标记经新增 build_info 命令移入自绘标题栏,任务栏标题保留;最大化时去圆角;遮罩选区窗不受影响。
- 2026-11-01 **回退:整窗圆角方案实测不佳**,恢复原生边框窗口(代码精确还原至 32a179c);实验实现保留在 6d6bec6/74bb149 与对应回退提交中,后续若重拾可参考。
- 2026-11-01 **产品改名**(人工反馈):工具名 **OfflineQR**,界面标题 **极简二维码**——productName/identifier/窗口标题/界面/E2E 选择器/绿色版脚本/Release 工作流/README 同步;Cargo 与 npm 包名保持 qr-tool(debug exe 路径稳定)。待办:README 内容整体刷新(仍停留在 v1.0 识别版描述)。
- 2026-11-03 **fix:最小化后选区完成主窗不弹出**(人工反馈):SW_SHOW 不还原最小化状态 → restore_main_window(unminimize+show+set_focus),finish/启动失败统一走该例程;Alt+W 最小化时还原+聚焦;用户主动取消仅显示不抢焦点。
- 2026-11-03 卡片高度与光标打磨(人工反馈):收起不回落根因 = 展开期同步的缩略图内联宽度经图片固有比例把高度钉死 → 缩略图固定 64×64 与卡片高度解耦;展开态封顶 220px 滚动;文本块 contenteditable(plaintext-only)+ beforeinput 拦截 → 点击位置闪烁光标、可拖选复制、内容不可改。
- 2026-11-03 **fix:原始像素 IPC 黑屏卡死**(内测发现):CSP 拦截二进制 Response 传输 → boot 中断遮罩黑屏;CSP 放行 ipc 通道 + 取消处理器先行注册 + 取图失败兜底恢复主窗。
- 2026-11-02 **fix:遮罩窗混合 DPI 几何错位**(第三方反馈 2K 屏选区放大 1.5 倍遮挡邻屏):逻辑坐标经"窗口创建时所在显示器"的缩放换算是歧义源头;遮罩窗几何全面改物理像素(隐藏创建 → Physical 落位 → show),scale_factor/实测视口入日志;100% 环境行为不变。
- 2026-11-03 **perf:弹出耗时优化**:Fast PNG 编码 + 截屏线程/遮罩窗创建并行 + 遮罩前端轮询取图(3s 上限);预期"点击 → 遮罩可见"从 ~1.7s 压到 ~0.8s(debug 环境)。
- 2026-11-01 **对内改名**(人工反馈"对内对外名字全改"):Cargo 包 offlineqr、二进制 **OfflineQR.exe**(debug/release 产物名统一)、lib offlineqr_lib、npm 包 offlineqr、日志文件 offlineqr-YYYYMMDD.log(当日旧 qr-tool-*.log 保留)、绿色版与 CI zip 名 OfflineQR_*;debug exe 路径变为 target/debug/OfflineQR.exe。
