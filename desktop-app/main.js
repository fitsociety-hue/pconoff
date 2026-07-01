const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, shell, powerMonitor, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');

const CONFIG_PATH = path.join(app.getPath('userData'), 'user_config.json');
const GAS_URL = "https://script.google.com/macros/s/AKfycbz2nRL7fitLd_RDcQrj0l--8iSl7lvtf4aaSse3eIKuNdh7-gLIwzaGmoKYXsWteF8/exec";

let tray = null;
let mainWindow = null;
let isQuitting = false;
let isQuittingFromTray = false;
let safeToQuit = false;
let shutdownHandled = false;
let shutdownWatcherProcess = null;

// 사용자 설정 불러오기
function getUserConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        }
    } catch (e) {
        console.error("Config read error", e);
    }
    return { name: '' };
}

function saveUserConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
}

// 시간 포맷 유틸리티
function pad(n) {
    return n.toString().padStart(2, '0');
}

function formatDateTimeNow() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function getTodayStr() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
}

// HTTP GET 요청 (순차 전송용)
function sendSyncRequest(action, name, timeStr = null, logDate = null) {
    if (!name) return Promise.resolve();
    
    return new Promise((resolve, reject) => {
        const now = new Date();
        
        if (!timeStr) {
            timeStr = formatDateTimeNow();
        }
        if (!logDate) {
            logDate = timeStr.substring(0, 10);
        }
        
        const timeParam = action === 'recordBoot' ? `bootTime=${encodeURIComponent(timeStr)}` : `offTime=${encodeURIComponent(timeStr)}`;
        const urlString = `${GAS_URL}?action=${action}&name=${encodeURIComponent(name)}&${timeParam}&logDate=${encodeURIComponent(logDate)}&isDesktop=true&t=${Date.now()}`;
        
        console.log(`Sending ${action} for ${name} at ${timeStr} (logDate: ${logDate})`);
        
        if (app.isReady()) {
            const request = net.request(urlString);
            request.on('response', (response) => {
                let data = '';
                response.on('data', (chunk) => data += chunk);
                response.on('end', () => resolve(data));
            });
            request.on('error', (err) => {
                console.error(`Failed to send ${action}:`, err);
                resolve(); // 실패해도 Promise 체인이 깨지지 않도록 resolve 처리
            });
            request.end();
        } else {
            exec(`curl.exe -s -L "${urlString}"`, { encoding: 'utf-8' }, (error, stdout) => {
                resolve(stdout || '');
            });
        }
    });
}

// OS 강제 종료/절전 등 비동기 응답을 기다릴 수 없는 경우를 대비한 동기식 HTTP 요청
function sendSyncShutdownRequest(action, name) {
    if (!name) return;
    try {
        const { execSync } = require('child_process');
        const timeStr = formatDateTimeNow();
        const logDate = timeStr.substring(0, 10);
        
        const timeParam = action === 'recordBoot' ? `bootTime=${encodeURIComponent(timeStr)}` : `offTime=${encodeURIComponent(timeStr)}`;
        const url = `${GAS_URL}?action=${action}&name=${encodeURIComponent(name)}&${timeParam}&logDate=${encodeURIComponent(logDate)}&isDesktop=true&t=${Date.now()}`;
        
        // 최대 3초 대기하며 동기적으로 실행 (OS 종료 지연 유도 및 네트워크 전송 보장)
        execSync(`curl.exe -s -L -m 3 "${url}"`, { windowsHide: true, timeout: 3000 });
        console.log(`Successfully sent sync request for ${action} for ${name} at ${timeStr}`);
    } catch(e) {
        console.error("Sync shutdown request failed", e);
    }
}

// ============================================================
// 이벤트 로그 파싱 유틸리티
// ============================================================
function parseEventsFromXml(stdout) {
    const events = [];
    if (!stdout || stdout.trim() === '') return events;
    
    const eventBlocks = stdout.split('</Event>');
    for (const block of eventBlocks) {
        const idMatch = block.match(/<EventID(?:[^>]*)>(\d+)<\/EventID>/);
        const timeMatch = block.match(/<TimeCreated SystemTime='([^']+)'/);
        if (idMatch && timeMatch) {
            const id = parseInt(idMatch[1], 10);
            const dateObj = new Date(timeMatch[1]);
            const kstDate = new Date(dateObj.getTime() + (9 * 60 * 60 * 1000));
            const timeStr = `${kstDate.getUTCFullYear()}-${pad(kstDate.getUTCMonth()+1)}-${pad(kstDate.getUTCDate())} ${pad(kstDate.getUTCHours())}:${pad(kstDate.getUTCMinutes())}:${pad(kstDate.getUTCSeconds())}`;
            events.push({ Id: id, Time: timeStr });
        }
    }
    
    // 시간순 정렬 (오름차순)
    events.sort((a, b) => a.Time.localeCompare(b.Time));
    return events;
}

// ============================================================
// 이벤트 로그 동기화 (재부팅 vs 최종 종료 구분 로직 포함)
// ============================================================
function syncEventLogs(name) {
    if (!name) return;
    console.log("Starting event log sync...");
    
    // 3일 전(259,200,000ms) 기준으로 스캔
    const command = `wevtutil qe System /q:"*[System[TimeCreated[timediff(@SystemTime) <= 259200000] and ((EventID=1 and Provider[@Name='Microsoft-Windows-Power-Troubleshooter']) or EventID=12 or EventID=6005 or EventID=6006 or EventID=6008 or EventID=6009 or EventID=7001 or EventID=7002 or EventID=1074 or EventID=42 or EventID=13)]]" /f:xml`;
    
    exec(command, { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 5 }, async (error, stdout, stderr) => {
        if (error) {
            console.error("Failed to execute wevtutil command", error);
            return;
        }
        
        const events = parseEventsFromXml(stdout);
        if (events.length === 0) return;
        
        // 부팅 관련 이벤트 ID
        const bootIds = [12, 6005, 6009, 7001, 1]; // EventID=1 은 Power-Troubleshooter (절전 복귀)
        // 종료 관련 이벤트 ID  
        const offIds = [1074, 42, 7002, 6006, 13]; // 6006=깨끗한 종료, 13=종료, 1074=사용자 종료/재시작
        
        console.log(`Parsed ${events.length} events from log`);
        
        // =============================================================
        // 핵심 로직: 재부팅과 최종 종료 구분
        // 날짜별로 이벤트를 그룹화한 뒤, "종료 이벤트 뒤에 같은 날 부팅 이벤트가 따르면 재부팅"
        // "종료 이벤트 뒤에 부팅 이벤트가 없으면 최종 종료"
        // =============================================================
        
        // 날짜별로 그룹화
        const dailyEvents = {};
        events.forEach(e => {
            const dateStr = e.Time.substring(0, 10);
            if (!dailyEvents[dateStr]) dailyEvents[dateStr] = [];
            dailyEvents[dateStr].push(e);
        });
        
        const dailyLogs = {};
        
        for (const [dateStr, dayEvents] of Object.entries(dailyEvents)) {
            if (!dailyLogs[dateStr]) {
                dailyLogs[dateStr] = { bootTime: null, offTime: null };
            }
            
            // 해당 날짜의 이벤트를 시간순으로 정렬 (이미 정렬됨)
            let firstBootTime = null;
            let lastFinalOffTime = null;
            
            for (let i = 0; i < dayEvents.length; i++) {
                const ev = dayEvents[i];
                const isBootEvent = bootIds.includes(ev.Id);
                const isOffEvent = offIds.includes(ev.Id);
                
                // 첫 번째 부팅 시간 기록
                if (isBootEvent && !firstBootTime) {
                    firstBootTime = ev.Time;
                }
                
                // 종료 이벤트인 경우, 그 뒤에 같은 날짜 안에서 부팅 이벤트가 있는지 확인
                if (isOffEvent) {
                    let isReboot = false;
                    
                    // 현재 종료 이벤트 이후의 이벤트 확인
                    for (let j = i + 1; j < dayEvents.length; j++) {
                        if (bootIds.includes(dayEvents[j].Id)) {
                            // 종료 후 같은 날 부팅이 있으면 → 재부팅
                            isReboot = true;
                            break;
                        }
                    }
                    
                    // 다음 날 이벤트도 확인 (자정 직전 종료 → 자정 직후 부팅 케이스)
                    if (!isReboot) {
                        const nextDateObj = new Date(dateStr + 'T00:00:00');
                        nextDateObj.setDate(nextDateObj.getDate() + 1);
                        const nextDateStr = `${nextDateObj.getFullYear()}-${pad(nextDateObj.getMonth()+1)}-${pad(nextDateObj.getDate())}`;
                        
                        if (dailyEvents[nextDateStr]) {
                            const nextDayEvents = dailyEvents[nextDateStr];
                            // 다음 날 첫 번째 이벤트가 부팅이고, 종료 후 5분 이내라면 재부팅으로 간주
                            for (const nextEv of nextDayEvents) {
                                if (bootIds.includes(nextEv.Id)) {
                                    const offTime = new Date(ev.Time.replace(' ', 'T'));
                                    const bootTime = new Date(nextEv.Time.replace(' ', 'T'));
                                    const diffMinutes = (bootTime - offTime) / (1000 * 60);
                                    if (diffMinutes <= 5) {
                                        isReboot = true;
                                    }
                                    break;
                                }
                            }
                        }
                    }
                    
                    if (!isReboot) {
                        // 재부팅이 아닌 최종 종료 → offTime으로 기록
                        // 여러 최종 종료가 있을 수 있으므로 가장 늦은 시간을 사용
                        if (!lastFinalOffTime || ev.Time > lastFinalOffTime) {
                            lastFinalOffTime = ev.Time;
                        }
                    } else {
                        console.log(`[${dateStr}] Reboot detected at ${ev.Time} - skipping as offTime`);
                    }
                }
            }
            
            dailyLogs[dateStr].bootTime = firstBootTime;
            dailyLogs[dateStr].offTime = lastFinalOffTime;
        }
        
        console.log("Parsed daily logs (reboot-aware):", dailyLogs);
        
        const todayStr = getTodayStr();
        
        // 구글 앱스 스크립트(GAS) 동시성 오류 방지를 위해 순차적(Sequential) 전송
        for (const [dateStr, log] of Object.entries(dailyLogs)) {
            
            if (log.bootTime) {
                await sendSyncRequest('recordBoot', name, log.bootTime, dateStr);
                await new Promise(r => setTimeout(r, 500)); // 0.5초 대기
            }
            if (log.offTime) {
                await sendSyncRequest('recordOff', name, log.offTime, dateStr);
                await new Promise(r => setTimeout(r, 500)); // 0.5초 대기
            }
        }
        console.log("Event log sync completed.");
    });
}

// ============================================================
// 부팅 시 과거 종료 시간 역추적
// 마지막으로 기록하지 못한 종료 시간을 찾아서 전송
// ============================================================
function syncLastShutdownTime(name) {
    if (!name) return;
    console.log("Syncing last shutdown time from previous session...");
    
    // 최근 3일 이내의 종료 이벤트만 검색
    const command = `wevtutil qe System /q:"*[System[TimeCreated[timediff(@SystemTime) <= 259200000] and (EventID=1074 or EventID=42 or EventID=7002 or EventID=6006 or EventID=13)]]" /f:xml /rd:true /c:10`;
    
    exec(command, { encoding: 'utf-8', maxBuffer: 1024 * 1024 }, async (error, stdout) => {
        if (error) {
            console.error("Failed to get last shutdown time", error);
            return;
        }
        
        const events = parseEventsFromXml(stdout);
        if (events.length === 0) return;
        
        // 가장 최근 종료 이벤트 (역순으로 가져왔지만 parseEventsFromXml이 정렬하므로 마지막 요소가 가장 최근)
        const lastOff = events[events.length - 1];
        const offDateStr = lastOff.Time.substring(0, 10);
        const todayStr = getTodayStr();
        
        // 오늘이 아닌 과거 날짜의 종료 이벤트라면 전송
        if (offDateStr !== todayStr) {
            console.log(`Found previous shutdown at ${lastOff.Time}, sending to server...`);
            await sendSyncRequest('recordOff', name, lastOff.Time, offDateStr);
        }
    });
}

// ============================================================
// 실시간 Windows 이벤트 로그 감시 (PowerShell 기반)
// 종료 이벤트 발생 시 즉시 서버에 전송
// ============================================================
function startShutdownWatcher(name) {
    if (!name) return;
    if (shutdownWatcherProcess) {
        console.log("Shutdown watcher already running.");
        return;
    }
    
    console.log("Starting real-time shutdown event watcher...");
    
    // PowerShell 스크립트: System 이벤트 로그를 감시하여 종료 관련 이벤트가 발생하면 출력
    const psScript = `
$query = @"
<QueryList>
  <Query Id="0" Path="System">
    <Select Path="System">
      *[System[(EventID=1074 or EventID=42 or EventID=7002 or EventID=6006 or EventID=13)]]
    </Select>
  </Query>
</QueryList>
"@

try {
    $watcher = New-Object System.Diagnostics.Eventing.Reader.EventLogWatcher -ArgumentList (New-Object System.Diagnostics.Eventing.Reader.EventLogQuery("System", [System.Diagnostics.Eventing.Reader.PathType]::LogName, $query))
    
    Register-ObjectEvent -InputObject $watcher -EventName EventRecordWritten -Action {
        $record = $Event.SourceEventArgs.EventRecord
        $timeCreated = $record.TimeCreated
        if ($timeCreated) {
            $kstTime = $timeCreated.ToLocalTime()
            $formatted = $kstTime.ToString("yyyy-MM-dd HH:mm:ss")
            Write-Output "SHUTDOWN_EVENT|$($record.Id)|$formatted"
            [Console]::Out.Flush()
        }
    } | Out-Null
    
    $watcher.Enabled = $true
    
    Write-Output "WATCHER_STARTED"
    [Console]::Out.Flush()
    
    # 무한 대기 (프로세스가 살아있는 동안 계속 감시)
    while ($true) {
        Start-Sleep -Seconds 1
    }
} catch {
    Write-Output "WATCHER_ERROR|$($_.Exception.Message)"
    [Console]::Out.Flush()
}
`;
    
    shutdownWatcherProcess = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript
    ], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
    });
    
    shutdownWatcherProcess.stdout.on('data', async (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            
            if (trimmed === 'WATCHER_STARTED') {
                console.log("Real-time shutdown watcher is active.");
                continue;
            }
            
            if (trimmed.startsWith('WATCHER_ERROR')) {
                console.error("Watcher error:", trimmed);
                continue;
            }
            
            if (trimmed.startsWith('SHUTDOWN_EVENT')) {
                const parts = trimmed.split('|');
                if (parts.length >= 3) {
                    const eventId = parts[1];
                    const timeStr = parts[2];
                    const logDate = timeStr.substring(0, 10);
                    
                    console.log(`[Real-time] Shutdown event detected: EventID=${eventId}, Time=${timeStr}`);
                    
                    // 즉시 서버에 전송
                    try {
                        await sendSyncRequest('recordOff', name, timeStr, logDate);
                        console.log(`[Real-time] Successfully sent offTime: ${timeStr}`);
                    } catch (err) {
                        console.error("[Real-time] Failed to send offTime:", err);
                    }
                }
            }
        }
    });
    
    shutdownWatcherProcess.stderr.on('data', (data) => {
        console.error("Watcher stderr:", data.toString());
    });
    
    shutdownWatcherProcess.on('exit', (code) => {
        console.log(`Shutdown watcher process exited with code ${code}`);
        shutdownWatcherProcess = null;
    });
    
    shutdownWatcherProcess.on('error', (err) => {
        console.error("Failed to start shutdown watcher:", err);
        shutdownWatcherProcess = null;
    });
}

// 종료 시 watcher 프로세스 정리
function stopShutdownWatcher() {
    if (shutdownWatcherProcess) {
        console.log("Stopping shutdown watcher...");
        try {
            shutdownWatcherProcess.kill();
        } catch (e) {
            console.error("Error stopping watcher:", e);
        }
        shutdownWatcherProcess = null;
    }
}

function createTray() {
    tray = new Tray(path.join(__dirname, 'icon.png'));
    const contextMenu = Menu.buildFromTemplate([
        { label: '설정 열기', click: () => mainWindow.show() },
        { label: '근태 대시보드 열기(웹)', click: () => shell.openExternal('https://fitsociety-hue.github.io/pconoff/') },
        { type: 'separator' },
        { 
            label: '완전 종료', 
            click: () => {
                isQuittingFromTray = true;
                app.quit();
            } 
        }
    ]);
    tray.setToolTip('PC 자동 출퇴근 모니터링');
    tray.setContextMenu(contextMenu);
    
    tray.on('double-click', () => {
        mainWindow.show();
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 480,
        height: 420,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile('index.html');

    // 최소화 및 닫기 버튼 이벤트 (트레이로 숨김)
    mainWindow.on('close', (event) => {
        if (!isQuittingFromTray && !safeToQuit) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
}

// OS 시작 시 자동 실행 설정
app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe')
});

app.whenReady().then(() => {
    try {
        createTray();
    } catch(e) { console.error("Tray error (missing icon?)", e); }
    
    createWindow();

    const config = getUserConfig();
    if (!config.name) {
        mainWindow.show();
    } else {
        console.log("Starting event log sync on boot...");
        
        // 1. 과거 미전송 종료 시간 역추적 (부팅 직후)
        syncLastShutdownTime(config.name);
        
        // 2. 전체 이벤트 로그 동기화 (재부팅 구분 포함)
        setTimeout(() => {
            syncEventLogs(config.name);
        }, 3000); // 역추적 완료 후 3초 뒤 실행
        
        // 3. 실시간 종료 이벤트 감시 시작
        startShutdownWatcher(config.name);
        
        // 4. 1시간 마다 정기 동기화 수행
        setInterval(() => {
            syncEventLogs(config.name);
        }, 3600000);
        
        powerMonitor.on('suspend', () => {
            console.log("System suspending. Sending quick off record...");
            sendSyncShutdownRequest('recordOff', config.name);
        });

        powerMonitor.on('resume', () => {
            console.log("System resuming. Syncing event logs...");
            syncEventLogs(config.name);
            // watcher가 죽었을 수 있으므로 재시작
            startShutdownWatcher(config.name);
        });
    }
    
    // 시간외근무 체크 타이머 시작
    startOvertimeCheck();
});

let overtimeCheckedToday = false;

function startOvertimeCheck() {
    setInterval(() => {
        const now = new Date();
        const kstTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Seoul"}));
        const hour = kstTime.getHours();
        const minute = kstTime.getMinutes();

        // 18시 09분에 팝업 표시
        if (hour === 18 && minute === 9 && !overtimeCheckedToday) {
            overtimeCheckedToday = true;
            
            dialog.showMessageBox({
                type: 'question',
                buttons: ['신청함', '미신청'],
                title: '시간외근무 확인',
                message: '시간외근무 신청 여부를 확인해주세요.',
                detail: '현재 대한민국 시간 18:09 입니다.\n오늘 시간외근무를 신청하셨습니까?'
            }).then(result => {
                if (result.response === 1) { // '미신청' 버튼
                    dialog.showMessageBox({
                        type: 'warning',
                        buttons: ['확인'],
                        title: '퇴근 독려',
                        message: '시간외근무 미신청자입니다.\n신속히 PC를 종료하고 퇴근해주시기 바랍니다.'
                    });
                }
            });
        }
        
        if (hour === 0 && minute === 0) {
            overtimeCheckedToday = false;
        }
    }, 60000);
}

// 앱 완전 종료 전 처리
app.on('before-quit', (e) => {
    safeToQuit = true;
    
    // watcher 프로세스 정리
    stopShutdownWatcher();
    
    if (!shutdownHandled) {
        const config = getUserConfig();
        if (config.name) {
            if (isQuittingFromTray) {
                // 트레이에서 "완전 종료"를 선택한 경우: 앱만 종료하므로 offTime 기록하지 않음
                console.log("App quitting from tray. Not recording offTime (app-only exit).");
            } else {
                // OS 종료 또는 다른 이유로 종료되는 경우: offTime 기록
                console.log("App quitting (OS shutdown/logoff). Sending quick off record...");
                sendSyncShutdownRequest('recordOff', config.name);
            }
            shutdownHandled = true;
        }
    }
});

app.on('session-end', () => {
    if (shutdownHandled) return;
    
    // OS 세션 종료 시 (로그오프, 종료, 재시작) offTime 기록
    const config = getUserConfig();
    if (config.name) {
        console.log("System session ending. Sending quick off record...");
        sendSyncShutdownRequest('recordOff', config.name);
        shutdownHandled = true;
    }
});

// IPC 통신 (UI <-> Main)
ipcMain.handle('get-config', () => {
    return getUserConfig();
});

ipcMain.on('save-config', (event, newName) => {
    const config = getUserConfig();
    const isFirstTime = !config.name;
    
    config.name = newName;
    saveUserConfig(config);
    
    if (isFirstTime && newName) {
        syncEventLogs(newName);
        startShutdownWatcher(newName);
    }
    
    mainWindow.hide();
});

ipcMain.on('open-dashboard', () => {
    shell.openExternal('https://fitsociety-hue.github.io/pconoff/');
});
