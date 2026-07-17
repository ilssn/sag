//! sidecar 监督器（ADR-0017）：拉起、协议解析、看门狗、重启策略。
//!
//! 状态机：PortCheck → Spawning → Starting{phase} → Ready
//!   · post-ready 崩溃 → 重启 ≤3（2/8/30s 退避；健康 10 分钟后计数清零）
//!   · 终态错误码（port-conflict / instance-already-running / migration-failed /
//!     engine-data-incompatible）与显式退出 → 永不自动重启
//! 超时预算：spawn→start ≤30s；任意事件重置 60s 沉默看门狗；绝对上限 15min。

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;
use tokio::time::timeout;

use super::protocol::{self, SidecarEvent, PROTOCOL_VERSION};
use crate::{ports, prefs, window};

const START_EVENT_TIMEOUT: Duration = Duration::from_secs(30);
const SILENCE_WATCHDOG: Duration = Duration::from_secs(60);
const ABSOLUTE_STARTUP_CAP: Duration = Duration::from_secs(15 * 60);
const GRACEFUL_SHUTDOWN: Duration = Duration::from_secs(10);
const MAX_RESTARTS: u32 = 3;
const RESTART_BACKOFF_SECONDS: [u64; 3] = [2, 8, 30];
const HEALTHY_RESET: Duration = Duration::from_secs(10 * 60);

/// 广播给 boot 页与前端的启动状态（`sag://startup` / `sag://sidecar-status`）。
#[derive(Debug, Clone, Serialize)]
pub struct BootPayload {
    pub state: String, // "phase" | "error" | "ready"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempt: Option<u32>,
}

impl BootPayload {
    fn phase(phase: &str) -> Self {
        Self {
            state: "phase".into(),
            phase: Some(phase.into()),
            code: None,
            message: None,
            port: None,
            current: None,
            total: None,
            attempt: None,
        }
    }

    fn error(code: &str, message: String, port: Option<u16>) -> Self {
        Self {
            state: "error".into(),
            phase: None,
            code: Some(code.into()),
            message: Some(message),
            port,
            current: None,
            total: None,
            attempt: None,
        }
    }
}

struct ProcessHandles {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
}

pub struct Supervisor {
    app: AppHandle,
    process: Mutex<ProcessHandles>,
    status: StdMutex<BootPayload>,
    quitting: AtomicBool,
    restarts: StdMutex<(u32, Option<Instant>)>, // (attempts, ready_since)
}

impl Supervisor {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            process: Mutex::new(ProcessHandles { child: None, stdin: None }),
            status: StdMutex::new(BootPayload::phase("starting")),
            quitting: AtomicBool::new(false),
            restarts: StdMutex::new((0, None)),
        }
    }

    /// boot 页拉取当前状态（补上窗口创建前错过的事件）。
    pub fn current_status(&self) -> BootPayload {
        self.status.lock().expect("status lock").clone()
    }

    pub fn is_quitting(&self) -> bool {
        self.quitting.load(Ordering::SeqCst)
    }

    fn broadcast(&self, payload: BootPayload) {
        *self.status.lock().expect("status lock") = payload.clone();
        let _ = self.app.emit("sag://startup", payload.clone());
        let _ = self.app.emit("sag://sidecar-status", payload);
    }

    fn selected_port(&self) -> u16 {
        let config_dir = self
            .app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        prefs::load(&config_dir).port.unwrap_or(ports::DEFAULT_PORT)
    }

    /// 解析 sidecar 可执行：release 用资源目录 onedir（ADR-0019），
    /// debug 允许 SAG_SIDECAR_COMMAND 覆盖（默认 apps/api venv）。
    fn sidecar_command(&self) -> Result<Command, String> {
        if cfg!(debug_assertions) {
            if let Ok(custom) = std::env::var("SAG_SIDECAR_COMMAND") {
                let mut parts = custom.split_whitespace();
                let program = parts.next().ok_or("SAG_SIDECAR_COMMAND 为空")?;
                let mut command = Command::new(program);
                command.args(parts);
                return Ok(command);
            }
            // dev 默认：仓库内 venv 直跑模块
            let repo_python = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../api/.venv/bin/python");
            let mut command = Command::new(repo_python);
            command.arg("-m").arg("sag_api");
            return Ok(command);
        }
        let resource_dir = self
            .app
            .path()
            .resource_dir()
            .map_err(|e| format!("无法解析资源目录：{e}"))?;
        let binary = if cfg!(windows) { "sag-api.exe" } else { "sag-api" };
        Ok(Command::new(resource_dir.join("sidecar").join(binary)))
    }

    /// 主启动流程；spawn 于 setup 中的 tokio 任务。
    pub async fn start(self: std::sync::Arc<Self>) {
        loop {
            if self.is_quitting() {
                return;
            }
            let port = self.selected_port();

            self.broadcast(BootPayload::phase("port-check"));
            if !ports::probe(port) {
                self.broadcast(BootPayload::error(
                    "port-conflict",
                    format!("端口 {port} 已被其他程序占用"),
                    Some(port),
                ));
                return; // 终态：等待用户改端口后 retry_startup
            }

            let nonce = uuid::Uuid::new_v4().simple().to_string();
            match self.run_until_exit(port, &nonce).await {
                RunOutcome::Quit => return,
                RunOutcome::CrashedAfterReady => {
                    let attempt = {
                        let mut guard = self.restarts.lock().expect("restarts lock");
                        if let Some(since) = guard.1 {
                            if since.elapsed() >= HEALTHY_RESET {
                                guard.0 = 0;
                            }
                        }
                        guard.0 += 1;
                        guard.0
                    };
                    if attempt > MAX_RESTARTS {
                        self.broadcast(BootPayload::error(
                            "crash-loop",
                            "本地服务连续崩溃，已停止自动重启".into(),
                            None,
                        ));
                        window::show_boot_window(&self.app);
                        return;
                    }
                    let delay = RESTART_BACKOFF_SECONDS[(attempt as usize - 1).min(2)];
                    tracing::warn!(attempt, delay, "sidecar 退出，退避后重启");
                    let mut payload = BootPayload::phase("restarting");
                    payload.attempt = Some(attempt);
                    self.broadcast(payload);
                    tokio::time::sleep(Duration::from_secs(delay)).await;
                }
                RunOutcome::FailedBeforeReady(code, message) => {
                    self.broadcast(BootPayload::error(&code, message, None));
                    window::show_boot_window(&self.app);
                    return; // 就绪前失败一律等待用户处置（重试/看日志/退出）
                }
            }
        }
    }

    async fn run_until_exit(&self, port: u16, nonce: &str) -> RunOutcome {
        self.broadcast(BootPayload::phase("spawning"));

        let data_dir = match self.app.path().app_local_data_dir() {
            Ok(dir) => dir,
            Err(error) => {
                return RunOutcome::FailedBeforeReady(
                    "startup-failed".into(),
                    format!("无法解析应用数据目录：{error}"),
                )
            }
        };

        let mut command = match self.sidecar_command() {
            Ok(command) => command,
            Err(message) => return RunOutcome::FailedBeforeReady("startup-failed".into(), message),
        };
        command
            .arg("serve")
            .arg("--data-dir")
            .arg(&data_dir)
            .arg("--port")
            .arg(port.to_string())
            .arg("--nonce")
            .arg(nonce)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        {
            // CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
            #[allow(unused_imports)]
            use std::os::windows::process::CommandExt as _;
            command.creation_flags(0x0800_0000 | 0x0000_0200);
        }

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                return RunOutcome::FailedBeforeReady(
                    "startup-failed".into(),
                    format!("无法启动本地服务：{error}"),
                )
            }
        };

        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        crate::logging::pipe_sidecar_stderr(&self.app, stderr);
        {
            let mut guard = self.process.lock().await;
            guard.stdin = child.stdin.take();
            guard.child = Some(child);
        }

        self.broadcast(BootPayload::phase("starting"));
        let mut lines = BufReader::new(stdout).lines();
        let started_at = Instant::now();
        let mut seen_start = false;
        let mut ready = false;

        // ── 启动阶段：逐行读事件直到 ready / 失败 ─────────────────────
        while !ready {
            if started_at.elapsed() > ABSOLUTE_STARTUP_CAP {
                self.shutdown_process().await;
                return RunOutcome::FailedBeforeReady(
                    "startup-timeout".into(),
                    "本地服务启动超时（15 分钟）".into(),
                );
            }
            let wait = if seen_start { SILENCE_WATCHDOG } else { START_EVENT_TIMEOUT };
            let line = match timeout(wait, lines.next_line()).await {
                Err(_) => {
                    self.shutdown_process().await;
                    return RunOutcome::FailedBeforeReady(
                        "startup-timeout".into(),
                        if seen_start {
                            "本地服务长时间无响应".into()
                        } else {
                            "本地服务未在 30 秒内发出启动事件".into()
                        },
                    );
                }
                Ok(Ok(Some(line))) => line,
                Ok(_) => {
                    // stdout 关闭 = 进程退出
                    let detail = self.reap_exit_detail().await;
                    return RunOutcome::FailedBeforeReady(
                        "startup-failed".into(),
                        format!("本地服务在就绪前退出{detail}"),
                    );
                }
            };
            let Some(event) = protocol::parse_line(&line) else { continue };
            match self.apply_startup_event(&event, nonce, port) {
                StartupStep::Continue => {
                    seen_start = true;
                }
                StartupStep::Ready => {
                    ready = true;
                }
                StartupStep::Terminal(code, message) => {
                    self.shutdown_process().await;
                    return RunOutcome::FailedBeforeReady(code, message);
                }
            }
        }

        // ── 就绪：换装工作台窗口，记录健康起点 ────────────────────────
        {
            let mut guard = self.restarts.lock().expect("restarts lock");
            guard.1 = Some(Instant::now());
        }
        self.broadcast(BootPayload::phase("ready"));
        if let Err(error) = window::show_main_window(&self.app, port) {
            tracing::error!(%error, "创建工作台窗口失败");
        }
        {
            let mut done = BootPayload::phase("ready");
            done.state = "ready".into();
            done.port = Some(port);
            self.broadcast(done);
        }

        // ── 运行期：等待退出（stdout EOF 即进程结束的可靠信号）────────
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = protocol::parse_line(&line); // 运行期事件目前仅记录
        }
        let exit_detail = self.reap_exit_detail().await;
        if self.is_quitting() {
            return RunOutcome::Quit;
        }
        tracing::warn!(detail = %exit_detail, "sidecar 于就绪后退出");
        RunOutcome::CrashedAfterReady
    }

    fn apply_startup_event(&self, event: &SidecarEvent, nonce: &str, port: u16) -> StartupStep {
        // 全部事件校验 nonce：端口被陌生进程占据时绝不误认（ADR-0017）
        if event.nonce.as_deref() != Some(nonce) {
            tracing::warn!(event = %event.event, "事件 nonce 不匹配（忽略）");
            return StartupStep::Continue;
        }
        match event.event.as_str() {
            "start" => {
                self.broadcast(BootPayload::phase("starting"));
                StartupStep::Continue
            }
            "migration" => {
                let mut payload = BootPayload::phase("migrating");
                payload.current = event.current;
                payload.total = event.total;
                self.broadcast(payload);
                StartupStep::Continue
            }
            "engine-init" => {
                self.broadcast(BootPayload::phase("engine-init"));
                StartupStep::Continue
            }
            "ready" => {
                if event.protocol != Some(PROTOCOL_VERSION) {
                    return StartupStep::Terminal(
                        "version-mismatch".into(),
                        format!(
                            "协议版本不匹配（sidecar={:?}，壳={PROTOCOL_VERSION}）",
                            event.protocol
                        ),
                    );
                }
                if !cfg!(debug_assertions) {
                    let shell_version = env!("CARGO_PKG_VERSION");
                    if event.app_version.as_deref() != Some(shell_version) {
                        return StartupStep::Terminal(
                            "version-mismatch".into(),
                            format!(
                                "组件版本不一致（sidecar={:?}，壳={shell_version}）",
                                event.app_version
                            ),
                        );
                    }
                }
                tracing::info!(
                    port,
                    capabilities = ?event.capabilities,
                    "sidecar 就绪"
                );
                StartupStep::Ready
            }
            "error" => {
                // 就绪前错误一律交给用户处置（重试/看日志/退出）；
                // 终态码与 recoverable=false 仅影响 boot 页指引文案（ADR-0017）。
                let code = event.code.clone().unwrap_or_else(|| "startup-failed".into());
                let message = event.message.clone().unwrap_or_else(|| "启动失败".into());
                StartupStep::Terminal(code, message)
            }
            _ => StartupStep::Continue,
        }
    }

    async fn reap_exit_detail(&self) -> String {
        let mut guard = self.process.lock().await;
        if let Some(mut child) = guard.child.take() {
            match timeout(Duration::from_secs(5), child.wait()).await {
                Ok(Ok(status)) => return format!("（退出码 {:?}）", status.code()),
                _ => {
                    let _ = child.start_kill();
                }
            }
        }
        String::new()
    }

    /// 优雅停机：关 stdin（后端主停机信号）→ 限时等待 → kill。
    pub async fn shutdown_process(&self) {
        let (stdin, child) = {
            let mut guard = self.process.lock().await;
            (guard.stdin.take(), guard.child.take())
        };
        if let Some(mut stdin) = stdin {
            let _ = stdin.shutdown().await;
            drop(stdin);
        }
        if let Some(mut child) = child {
            #[cfg(unix)]
            {
                if let Some(pid) = child.id() {
                    unsafe {
                        libc_kill(pid as i32);
                    }
                }
            }
            match timeout(GRACEFUL_SHUTDOWN, child.wait()).await {
                Ok(_) => tracing::info!("sidecar 已优雅退出"),
                Err(_) => {
                    tracing::warn!("sidecar 未在限时内退出，强制终止");
                    let _ = child.start_kill();
                    let _ = child.wait().await;
                }
            }
        }
    }

    /// 显式退出（托盘 Quit / Cmd+Q / OS 注销）。
    pub async fn quit(&self) {
        self.quitting.store(true, Ordering::SeqCst);
        self.shutdown_process().await;
    }

    /// boot 页「重试」：清理旧进程后重跑启动流程。
    pub fn retry(self: std::sync::Arc<Self>) {
        let supervisor = self;
        tauri::async_runtime::spawn(async move {
            supervisor.shutdown_process().await;
            {
                let mut guard = supervisor.restarts.lock().expect("restarts lock");
                *guard = (0, None);
            }
            supervisor.start().await;
        });
    }
}

enum StartupStep {
    Continue,
    Ready,
    Terminal(String, String),
}

enum RunOutcome {
    /// 显式退出流程。
    Quit,
    /// 就绪后崩溃 → 走退避重启。
    CrashedAfterReady,
    /// 就绪前失败（code, message）。
    FailedBeforeReady(String, String),
}

#[cfg(unix)]
unsafe fn libc_kill(pid: i32) {
    // SIGTERM：与 stdin EOF 互为冗余的停机信号
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    kill(pid, 15);
}
