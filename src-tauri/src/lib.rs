use std::io::Write as _;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::Engine as _;
use chrono::Local as LocalTime;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{Builder as GlobalShortcutBuilder, GlobalShortcutExt, Shortcut, ShortcutState};

static LOG_FILE: OnceLock<Option<PathBuf>> = OnceLock::new();

fn ensure_writable_dir(dir: &PathBuf) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    // 目录存在不代表可写(如 Program Files),做一次真实写探针
    let probe = dir.join(".write-probe");
    match std::fs::File::create(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// 日志文件解析规则(用户约束):优先 exe 同级 logs\(绿色版 / debug 版);
/// 不可写(安装版位于 Program Files)时回退应用数据目录。结果进程内缓存。
fn log_file_path(app: &AppHandle) -> Option<PathBuf> {
    LOG_FILE
        .get_or_init(|| {
            let date = LocalTime::now().format("%Y%m%d");
            if let Ok(exe) = std::env::current_exe() {
                if let Some(dir) = exe.parent() {
                    let candidate = dir.join("logs");
                    if ensure_writable_dir(&candidate) {
                        return Some(candidate.join(format!("offlineqr-{date}.log")));
                    }
                }
            }
            let fallback = app.path().app_local_data_dir().ok()?.join("logs");
            std::fs::create_dir_all(&fallback).ok()?;
            Some(fallback.join(format!("offlineqr-{date}.log")))
        })
        .clone()
}

/// 追加一行到当天日志文件(FR-10:人类可读,毫秒精度)
fn write_line(app: &AppHandle, line: &str) {
    println!("{line}");
    if let Some(path) = log_file_path(app) {
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{line}");
        }
    }
}

fn log_event(app: &AppHandle, scope: &str, message: &str) {
    let ts = LocalTime::now().format("%Y-%m-%d %H:%M:%S%.3f");
    write_line(app, &format!("[{ts}][{scope}] {message}"));
}

/// 单个显示器的截屏(原始 RGBA)与物理几何(混合 DPI 下"逻辑值经创建时主屏缩放
/// 换算"有歧义,曾致 2K+150% 屏的遮罩窗放大 1.5 倍遮挡邻屏——统一用物理像素定位)
#[derive(Clone)]
struct ScreenCapture {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    x: f64,
    y: f64,
    scale: f32,
    capture_ms: u32,
}

#[derive(Default)]
struct CaptureState(Mutex<Vec<ScreenCapture>>);

/// 隐藏主窗后等待 DWM 重新合成桌面的时长:60Hz 下约 9 帧。
/// hide() 立即改变窗口标志,但 DWM 在其后的合成帧才把窗口从桌面画面移除,
/// GDI 全屏截图取的正是已合成帧——不留等待会把主窗截进选区底图,
/// 遮罩窗展示底图时主窗就以"半透明残影"出现(Flameshot/Snipaste 同样留此等待)。
const DWM_RECOMPOSE_WAIT: Duration = Duration::from_millis(150);

/// 截屏:直接保留原始 RGBA 像素——不做任何编码/压缩/缩放,
/// 经二进制 IPC(tauri::ipc::Response)直传遮罩窗,免 base64/JSON/PNG 解码
/// (曾实测:PNG 编码 60-75ms + base64/JSON 传输 ~390ms + 前端解码 430-480ms 全部白费)。
fn capture_screen(screen: &screenshots::Screen) -> Result<ScreenCapture, String> {
    let t0 = Instant::now();
    let image = screen.capture().map_err(|e| e.to_string())?; // ImageBuffer<Rgba8>
    let (width, height) = (image.width(), image.height());
    let rgba = image.into_raw();
    Ok(ScreenCapture {
        width,
        height,
        rgba,
        x: f64::from(screen.display_info.x),
        y: f64::from(screen.display_info.y),
        scale: screen.display_info.scale_factor,
        capture_ms: t0.elapsed().as_millis() as u32,
    })
}

/// 主窗显隐:hide/show 必须在主线程上同步执行(跨线程 ShowWindow 不可靠,
/// 曾三次导致隐藏无效/截图带上主窗幽灵副本);run_on_main_thread 派发 + 标志位确认。
fn set_main_window_visible(app: &AppHandle, visible: bool) -> Result<(), String> {
    let done = Arc::new(AtomicBool::new(false));
    let flag = done.clone();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window("main") {
            let result = if visible { window.show() } else { window.hide() };
            match result {
                Ok(_) => log_event(&handle, "capture", &format!("主窗{}", if visible { "已恢复显示" } else { "已隐藏(避免污染选区画面)" })),
                Err(e) => log_event(&handle, "capture", &format!("主窗显隐失败:{e}")),
            }
        } else {
            log_event(&handle, "capture", "未找到主窗(label 不匹配)");
        }
        flag.store(true, Ordering::SeqCst);
    })
    .map_err(|e| e.to_string())?;
    let t0 = Instant::now();
    while !done.load(Ordering::SeqCst) {
        if t0.elapsed() > Duration::from_millis(500) {
            log_event(app, "capture", "主窗显隐确认超时");
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    Ok(())
}

fn close_all_overlays(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with("region-overlay") {
            let _ = window.close();
            log_event(app, "capture", &format!("遮罩窗 {label} 已关闭"));
        }
    }
}

/// 全局快捷键:显示/隐藏主窗(显隐必须主线程执行,与 set_main_window_visible 同款约束)
fn toggle_main_window(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window("main") {
            let visible = window.is_visible().unwrap_or(false);
            let result = if visible { window.hide() } else { window.show() };
            match result {
                Ok(_) => log_event(&handle, "hotkey", &format!("快捷键切换主窗{}", if visible { "隐藏" } else { "显示" })),
                Err(e) => log_event(&handle, "hotkey", &format!("快捷键切换主窗失败:{e}")),
            }
        }
    });
}

/// 触发屏幕选区:截屏(后台线程并行,含编码)与遮罩窗创建(主线程)同时进行,
/// 就绪后物理像素落位并显示——压缩"点击到遮罩弹出"的延迟。
/// 必须为 async:Windows 上在同步命令内创建窗口会死锁(命令阻塞主线程,
/// 而窗口创建又依赖主线程事件循环),参考 Tauri 官方文档的 async command 指引。
#[tauri::command]
async fn start_capture(app: AppHandle) -> Result<(), String> {
    let t0 = Instant::now();
    log_event(&app, "capture", "开始屏幕截取");
    // 先隐藏主窗(主线程同步执行):它不属于可选内容,且避免 UI 出现在选区画面里
    set_main_window_visible(&app, false)?;
    log_event(&app, "capture", &format!("主窗隐藏确认,累计 {}ms", t0.elapsed().as_millis()));
    // 等待 DWM 把已隐藏的主窗从桌面合成中移除后再截屏,杜绝残影进入底图
    std::thread::sleep(DWM_RECOMPOSE_WAIT);
    log_event(&app, "capture", &format!("等待 DWM 重新合成 {}ms,开始截屏", DWM_RECOMPOSE_WAIT.as_millis()));
    close_all_overlays(&app);
    let screens = screenshots::Screen::all().map_err(|e| e.to_string())?;
    if screens.is_empty() {
        return Err("未找到可用显示器".into());
    }
    let count = screens.len();
    let geoms: Vec<(i32, i32, u32, u32)> = screens
        .iter()
        .map(|s| {
            (
                s.display_info.x,
                s.display_info.y,
                s.display_info.width,
                s.display_info.height,
            )
        })
        .collect();
    // 截屏(后台线程)与遮罩窗创建(主线程)并行执行;原始像素经二进制 IPC 直传
    let handles: Vec<_> = screens
        .into_iter()
        .enumerate()
        .map(|(i, screen)| {
            let app = app.clone();
            std::thread::spawn(move || {
                let result = capture_screen(&screen);
                match &result {
                    Ok(sc) => log_event(&app, "capture", &format!(
                        "屏幕 {i}: {}x{} px @scale {:.2},物理位置 ({:.0},{:.0}),截屏 {}ms",
                        sc.width, sc.height, sc.scale, sc.x, sc.y, sc.capture_ms
                    )),
                    Err(e) => log_event(&app, "capture", &format!("屏幕 {i} 截屏失败:{e}")),
                }
                result
            })
        })
        .collect();
    // 失败兜底:close_all_overlays 会按 label 关闭已创建的隐藏遮罩窗并恢复主窗
    let setup = || -> Result<(), String> {
        let mut created = Vec::new();
        for i in 0..count {
            let label = format!("region-overlay-{i}");
            let window = WebviewWindowBuilder::new(
                &app,
                label.clone(),
                WebviewUrl::App("index.html".into()),
            )
            .title(format!("屏幕选区 {}", i + 1))
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .background_color(tauri::window::Color(0, 0, 0, 255))
            .build()
            .map_err(|e| {
                log_event(&app, "capture", &format!("遮罩窗 {label} 创建失败:{e}"));
                e.to_string()
            })?;
            created.push((label, window));
        }
        let captures: Vec<ScreenCapture> = handles
            .into_iter()
            .enumerate()
            .map(|(i, h)| {
                h.join()
                    .map_err(|e| format!("截屏线程崩溃:{e:?}"))?
                    .map_err(|e| format!("屏幕 {i} 截屏失败:{e}"))
            })
            .collect::<Result<Vec<_>, String>>()?;
        *app.state::<CaptureState>().0.lock().unwrap() = captures;
        log_event(&app, "capture", &format!("截屏+编码全部完成,累计 {}ms", t0.elapsed().as_millis()));
        // 物理像素落位后显示(几何与显示器一一对应,混合 DPI 无歧义)
        for (i, (label, window)) in created.iter().enumerate() {
            let (gx, gy, gw, gh) = geoms[i];
            if let Err(e) = window
                .set_position(Position::Physical(PhysicalPosition::new(gx, gy)))
                .and_then(|_| window.set_size(Size::Physical(PhysicalSize::new(gw, gh))))
                .and_then(|_| window.show())
            {
                log_event(&app, "capture", &format!("遮罩窗 {label} 几何落位失败:{e}"));
            }
            let scale = window.scale_factor().unwrap_or(0.0);
            let inner = window.inner_size().map(|s| (s.width, s.height)).unwrap_or((0, 0));
            log_event(
                &app,
                "capture",
                &format!(
                    "遮罩窗 {label} 几何就位并显示:物理 ({gx},{gy}) {gw}x{gh},scale {scale:.2},inner {}x{},累计 {}ms",
                    inner.0, inner.1, t0.elapsed().as_millis()
                ),
            );
        }
        Ok(())
    };
    if let Err(e) = setup() {
        close_all_overlays(&app);
        set_main_window_visible(&app, true)?;
        return Err(e);
    }
    Ok(())
}

/// 遮罩窗取原始截屏:二进制载荷 = 宽度 u32 LE + 高度 u32 LE + RGBA 像素,
/// 免 base64/JSON/PNG 解码。截屏未就绪时返回空载荷,遮罩窗前端轮询。
#[tauri::command]
fn get_capture_raw(app: AppHandle, index: usize) -> Result<tauri::ipc::Response, String> {
    let state = app.state::<CaptureState>();
    let guard = state.0.lock().unwrap();
    let payload = match guard.get(index) {
        Some(sc) => {
            let mut p = Vec::with_capacity(8 + sc.rgba.len());
            p.extend_from_slice(&sc.width.to_le_bytes());
            p.extend_from_slice(&sc.height.to_le_bytes());
            p.extend_from_slice(&sc.rgba);
            p
        }
        None => Vec::new(),
    };
    drop(guard);
    if payload.len() > 8 {
        log_event(&app, "capture", &format!("遮罩窗 {index} 取图:原始 {} 字节", payload.len()));
    }
    Ok(tauri::ipc::Response::new(payload))
}

/// 选区完成:Rust 侧只做中转(裁剪由遮罩窗 canvas 完成),关闭全部遮罩并广播给主窗
#[tauri::command]
async fn finish_capture(app: AppHandle, png_base64: String) -> Result<(), String> {
    log_event(&app, "capture", &format!("选区完成,回传 PNG base64 {} 字符", png_base64.len()));
    *app.state::<CaptureState>().0.lock().unwrap() = Vec::new();
    close_all_overlays(&app);
    set_main_window_visible(&app, true)?;
    app.emit("region-captured", png_base64)
        .map_err(|e| e.to_string())
}

/// 取消选区:关闭全部遮罩
#[tauri::command]
async fn cancel_capture(app: AppHandle) -> Result<(), String> {
    log_event(&app, "capture", "选区取消");
    *app.state::<CaptureState>().0.lock().unwrap() = Vec::new();
    close_all_overlays(&app);
    set_main_window_visible(&app, true)?;
    Ok(())
}

/// 识别失败的选区样张落盘(仅本地日志目录,用于定位裁剪内容问题)
#[tauri::command]
async fn dump_failed_region(app: AppHandle, png_base64: String) -> Result<String, String> {
    let dir = log_file_path(&app)
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("failed-region-{}.png", LocalTime::now().format("%H%M%S%.3f")));
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&png_base64)
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    log_event(&app, "capture", &format!("识别失败的选区样张已保存:{}", path.display()));
    Ok(path.display().to_string())
}

/// 前端日志批量落盘(FR-10)
#[tauri::command]
async fn append_log(app: AppHandle, lines: Vec<String>) -> Result<(), String> {
    for line in &lines {
        write_line(&app, line);
    }
    Ok(())
}

#[derive(Serialize)]
struct ReadImageFile {
    path: String,
    name: String,
    ok: bool,
    base64: String,
    error: String,
}

/// 原生文件对话框选图(桌面):返回完整路径;WebView2 不向网页暴露文件路径,
/// 必须经原生通道获取。取消/未选返回空列表。
#[tauri::command]
async fn pick_image_files(app: AppHandle) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let files = app
            .dialog()
            .file()
            .add_filter("图片", &["png", "jpg", "jpeg", "bmp", "gif", "webp"])
            .blocking_pick_files();
        Ok(files.unwrap_or_default().iter().map(|f| f.to_string()).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 按路径读取图片文件(桌面拖放/对话框路径 → base64;原生拖放事件只给路径不给句柄)
#[tauri::command]
async fn read_image_files(paths: Vec<String>) -> Result<Vec<ReadImageFile>, String> {
    let mut results = Vec::new();
    for path in paths {
        let name = std::path::Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone());
        match std::fs::read(&path) {
            Ok(bytes) => results.push(ReadImageFile {
                path: path.clone(),
                name,
                ok: true,
                base64: base64::engine::general_purpose::STANDARD.encode(bytes),
                error: String::new(),
            }),
            Err(e) => results.push(ReadImageFile {
                path: path.clone(),
                name,
                ok: false,
                base64: String::new(),
                error: e.to_string(),
            }),
        }
    }
    Ok(results)
}

// 壳负责窗口/打包/截屏:识别与生成等业务全部在前端完成。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CaptureState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            GlobalShortcutBuilder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let region = "alt+q".parse::<Shortcut>().unwrap();
                    let toggle = "alt+w".parse::<Shortcut>().unwrap();
                    let app = app.clone();
                    if shortcut == &region {
                        tauri::async_runtime::spawn(async move {
                            log_event(&app, "hotkey", "全局快捷键 Alt+Q 触发屏幕选区");
                            if let Err(e) = start_capture(app.clone()).await {
                                log_event(&app, "hotkey", &format!("快捷键发起选区失败:{e}"));
                            }
                        });
                    } else if shortcut == &toggle {
                        toggle_main_window(&app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();

            // 构建标记:标题栏显示构建时间,日志记录 exe 自身文件时间——用于确认运行的构建版本
            let build_ts: u64 = option_env!("BUILD_UNIX").and_then(|s| s.parse().ok()).unwrap_or(0);
            let build_label = if build_ts > 0 {
                use chrono::TimeZone as _;
                chrono::Local
                    .timestamp_opt(build_ts as i64, 0)
                    .earliest()
                    .map(|dt| dt.format("%m%d %H:%M:%S").to_string())
                    .unwrap_or_else(|| format!("unix:{build_ts}"))
            } else {
                "未知".into()
            };
            let exe_meta = std::env::current_exe()
                .ok()
                .and_then(|p| p.metadata().ok())
                .and_then(|m| m.modified().ok())
                .map(|t| {
                    let dt: chrono::DateTime<LocalTime> = t.into();
                    dt.format("%H:%M:%S").to_string()
                })
                .unwrap_or_else(|| "?".into());
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title(&format!(
                    "极简二维码 v{} [构建 {build_label} · exe {exe_meta}]",
                    app.package_info().version
                ));
            }
            log_event(
                &handle,
                "app",
                &format!(
                    "应用启动 v{},构建 {build_label},exe 修改时间 {exe_meta},日志文件:{}",
                    app.package_info().version,
                    log_file_path(&handle)
                        .map(|p| p.display().to_string())
                        .unwrap_or_else(|| "不可用".into())
                ),
            );
            // 全局快捷键:Alt+Q 屏幕选区识别,Alt+W 显示/隐藏主窗(冲突时降级为仅应用内可用)
            for (combo, desc) in [("alt+q", "屏幕选区识别"), ("alt+w", "显示/隐藏主窗")] {
                match handle.global_shortcut().register(combo) {
                    Ok(_) => log_event(&handle, "hotkey", &format!("已注册全局快捷键 {combo}({desc})")),
                    Err(e) => log_event(&handle, "hotkey", &format!("注册全局快捷键 {combo}({desc})失败,可能被其他程序占用:{e}")),
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_capture,
            get_capture_raw,
            finish_capture,
            cancel_capture,
            append_log,
            dump_failed_region,
            pick_image_files,
            read_image_files
        ])
        .run(tauri::generate_context!())
        .expect("OfflineQR 运行失败");
}
