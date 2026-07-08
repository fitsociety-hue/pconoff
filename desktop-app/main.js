const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, shell, powerMonitor, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');

// 로컬 종료 시간 캐시 파일 경로 (서버 전송 실패 시 다음 부팅 때 재전송용)
const SHUTDOWN_CACHE_PATH = path.join(app.getPath('userData'), 'shutdown_cache.json');

const CONFIG_PATH = path.join(app.getPath('userData'), 'user_config.json');
const GAS_URL = "https://script.google.com/macros/s/AKfycbyjuamlEgt6t5mTAafwOKhK3sKjZDSbriPsyoBljFQHY4LorAkmb7BMN0wyHVWK6rV0/exec";

let tray = null;
let mainWindow = null;
let isQuitting = false;
let isQuittingFromTray = false;
let safeToQuit = false;
let shutdownHandled = false;
let shutdownWatcherProcess = null;
let isOsShutdown = false;  // OS 종료/재시작에 의한 종료인지 여부
let heartbeatInterval = null;  // Heartbeat 타이머 (30초 간격으로 offTime 갱신)

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

// 파일 로깅 유틸리티 (필수-3)
function logToFile(message) {
    try {
        const logPath = path.join(app.getPath('userData'), 'app.log');
        const timeStr = formatDateTimeNow();
        fs.appendFileSync(logPath, `[${timeStr}] ${message}\n`);
    } catch (e) {
        console.error("Failed to write to log file:", e);
    }
}

// HTTP GET 요청 (순차 전송용)
function sendSyncRequest(action, name, timeStr = null, logDate = null, extraParams = '') {
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
        const urlString = `${GAS_URL}?action=${action}&name=${encodeURIComponent(name)}&${timeParam}&logDate=${encodeURIComponent(logDate)}&isDesktop=true${extraParams}&t=${Date.now()}`;
        
        const logMsg = `Sending ${action} for ${name} at ${timeStr} (logDate: ${logDate})${extraParams ? ' [' + extraParams + ']' : ''}`;
        console.log(logMsg);
        logToFile(`[SyncRequest] ${logMsg}`);
        
        if (app.isReady()) {
            const request = net.request(urlString);
            request.on('response', (response) => {
                let data = '';
                response.on('data', (chunk) => data += chunk);
                response.on('end', () => {
                    logToFile(`[SyncRequest] Success ${action} at ${timeStr}`);
                    resolve(data);
                });
            });
            request.on('error', (err) => {
                console.error(`Failed to send ${action}:`, err);
                logToFile(`[SyncRequest] ERROR ${action} at ${timeStr}: ${err.message}`);
                resolve(); // 실패해도 Promise 체인이 깨지지 않도록 resolve 처리
            });
            request.end();
        } else {
            exec(`curl.exe -s -L "${urlString}"`, { encoding: 'utf-8' }, (error, stdout) => {
                if (error) {
                    logToFile(`[SyncRequest] curl ERROR ${action} at ${timeStr}: ${error.message}`);
                } else {
                    logToFile(`[SyncRequest] curl Success ${action} at ${timeStr}`);
                }
                resolve(stdout || '');
            });
        }
    });
}

// 로컬 캐시에 종료 시간 저장 (서버 전송 실패 대비)
function saveShutdownCache(name, timeStr, logDate) {
    try {
        const cache = { name, timeStr, logDate, timestamp: Date.now() };
        fs.writeFileSync(SHUTDOWN_CACHE_PATH, JSON.stringify(cache));
        console.log(`[Cache] Saved shutdown time to local cache: ${timeStr}`);
    } catch(e) {
        console.error("[Cache] Failed to save shutdown cache:", e);
    }
}

// 부팅 시 캐시된 종료 시간이 있으면 서버로 재전송
function retryCachedShutdown(name) {
    try {
        if (!fs.existsSync(SHUTDOWN_CACHE_PATH)) return;
        const cache = JSON.parse(fs.readFileSync(SHUTDOWN_CACHE_PATH, 'utf-8'));
        if (cache && cache.timeStr && cache.name) {
            console.log(`[Cache] Found cached shutdown time: ${cache.timeStr} for ${cache.name}, retrying...`);
            sendSyncRequest('recordOff', cache.name, cache.timeStr, cache.logDate).then(() => {
                // 전송 성공 후 캐시 삭제
                try { fs.unlinkSync(SHUTDOWN_CACHE_PATH); } catch(e) {}
                console.log(`[Cache] Successfully sent cached shutdown time and cleared cache.`);
            }).catch(err => {
                console.error("[Cache] Failed to retry cached shutdown:", err);
            });
        }
    } catch(e) {
        console.error("[Cache] Error reading shutdown cache:", e);
    }
}

// OS 강제 종료/절전 등 비동기 응답을 기다릴 수 없는 경우를 대비한 동기식 HTTP 요청
// 개선: curl과 powershell을 동시에 실행하여 어느 한 쪽이라도 성공하도록 보장
function sendSyncShutdownRequest(action, name) {
    if (!name) return;
    try {
        const { spawn } = require('child_process');
        let timeStr = formatDateTimeNow();
        const logDate = timeStr.substring(0, 10);
        
        // 로컬 캐시에 저장 (서버 전송 실패 대비 백업)
        if (action === 'recordOff') {
            saveShutdownCache(name, timeStr, logDate);
        }
        
        const timeParam = action === 'recordBoot' ? `bootTime=${encodeURIComponent(timeStr)}` : `offTime=${encodeURIComponent(timeStr)}`;
        const url = `${GAS_URL}?action=${action}&name=${encodeURIComponent(name)}&${timeParam}&logDate=${encodeURIComponent(logDate)}&isDesktop=true&t=${Date.now()}`;
        
        // 방법 1: detached curl.exe (가장 빠름)
        try {
            const child = spawn('curl.exe', ['-s', '-L', '-m', '5', url], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true
            });
            child.unref();
            console.log(`[Shutdown] Spawned detached curl for ${action} at ${timeStr}`);
            logToFile(`[Shutdown] Spawned detached curl for ${action} at ${timeStr}`);
        } catch(e) {
            console.error("[Shutdown] curl.exe spawn failed:", e.message);
            logToFile(`[Shutdown] curl.exe spawn failed: ${e.message}`);
        }
        
        // 방법 2: detached powershell (curl 실패 대비 동시 실행)
        try {
            const child2 = spawn('powershell.exe', [
                '-NoProfile', '-WindowStyle', 'Hidden', '-Command',
                `try { Invoke-RestMethod -Uri '${url}' -TimeoutSec 5 } catch {}`
            ], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true
            });
            child2.unref();
            console.log(`[Shutdown] Spawned detached powershell for ${action} at ${timeStr}`);
            logToFile(`[Shutdown] Spawned detached powershell for ${action} at ${timeStr}`);
        } catch(e2) {
            console.error("[Shutdown] powershell spawn failed:", e2.message);
            logToFile(`[Shutdown] powershell spawn failed: ${e2.message}`);
        }
    } catch(e) {
        console.error("Sync shutdown request failed", e);
        logToFile(`[Shutdown] Sync shutdown request failed: ${e.message}`);
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
        const offIds = [1074, 42, 7002, 6006, 13, 6008]; // 6006=깨끗한 종료, 6008=비정상 종료, 13=종료, 1074=사용자 종료/재시작
        
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
                            // 종료 후 5분 이내에 부팅이 있으면 재부팅으로 간주 (그 외엔 정상 종료 후 재출근으로 간주)
                            const offTimeObj = new Date(ev.Time.replace(' ', 'T'));
                            const bootTimeObj = new Date(dayEvents[j].Time.replace(' ', 'T'));
                            const diffMinutes = (bootTimeObj - offTimeObj) / (1000 * 60);
                            if (diffMinutes <= 5) {
                                isReboot = true;
                            }
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
// Event ID 6006 (정상 종료)을 최우선으로 사용
// ============================================================
function syncLastShutdownTime(name) {
    if (!name) return;
    console.log("Syncing last shutdown time from previous session...");
    
    // 가장 신뢰도 높은 종료 이벤트 및 사용자 종료 이벤트 모두 통합 검색
    const commandAll = `wevtutil qe System /q:"*[System[TimeCreated[timediff(@SystemTime) <= 259200000] and (EventID=1074 or EventID=42 or EventID=7002 or EventID=6006 or EventID=13 or EventID=6008)]]" /f:xml /rd:true /c:20`;
    
    exec(commandAll, { encoding: 'utf-8', maxBuffer: 1024 * 1024 }, async (error, stdout) => {
        let events = [];
        if (!error) {
            events = parseEventsFromXml(stdout);
        }
        
        if (events.length === 0) {
            console.log("No shutdown events found in recent history.");
            return;
        }
        
        // 날짜별로 가장 마지막 종료 이벤트를 찾아 전송 (과거 기록 복구)
        const dateMap = {};
        for (const ev of events) {
            const evDateStr = ev.Time.substring(0, 10);
            if (!dateMap[evDateStr] || ev.Time > dateMap[evDateStr].Time) {
                dateMap[evDateStr] = ev;
            }
        }
        
        const sentDates = new Set();
        for (const [dateStr, ev] of Object.entries(dateMap)) {
            console.log(`[Recovery] Found past shutdown event for ${dateStr} (EventID=${ev.Id}) at ${ev.Time}, sending to server...`);
            await sendSyncRequest('recordOff', name, ev.Time, dateStr);
            await new Promise(r => setTimeout(r, 500));
            sentDates.add(dateStr);
        }
    });
}

// ============================================================
// 실시간 Windows 이벤트 로그 감시 (PowerShell 기반)
// [권장-5] 이 워쳐는 성공 시 조기 신호(Early Signal)일 뿐이며, 
// 실시간성의 최종 보장 수단은 하트비트(Heartbeat)입니다.
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
      *[System[(EventID=1074 or EventID=42 or EventID=7002 or EventID=6006 or EventID=13 or EventID=6008)]]
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
            $logDate = $kstTime.ToString("yyyy-MM-dd")
            Write-Output "SHUTDOWN_EVENT|$($record.Id)|$formatted"
            [Console]::Out.Flush()
            
            # PowerShell에서 직접 서버로 HTTP 요청 전송 (Node.js 종료 시 대비)
            # 개선: curl과 Invoke-RestMethod를 동시에 실행하여 전송 성공률 극대화
            $nameParam = [uri]::EscapeDataString("${name}")
            $timeParam = [uri]::EscapeDataString($formatted)
            $logDateParam = [uri]::EscapeDataString($logDate)
            $url = "${GAS_URL}?action=recordOff&name=$nameParam&offTime=$timeParam&logDate=$logDateParam&isDesktop=true&t=$($kstTime.Ticks)"
            
            # 방법 1: detached curl.exe (가장 빠름 - OS 종료 시에도 생존 가능)
            try {
                Start-Process -FilePath "curl.exe" -ArgumentList @("-s", "-L", "-m", "5", $url) -WindowStyle Hidden
            } catch {}
            
            # 방법 2: Invoke-RestMethod (curl 실패 시 대비 - 동시 실행)
            try {
                Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-Command", "try { Invoke-RestMethod -Uri '$url' -TimeoutSec 5 } catch {}") -WindowStyle Hidden
            } catch {}
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
        '-NoProfile', '-NonInteractive', '-Command', '-'
    ], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
    });
    
    shutdownWatcherProcess.stdin.write(psScript + '\n');
    shutdownWatcherProcess.stdin.end();
    
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
                    let timeStr = parts[2];
                    // 초 단위 유지 (절사 안함)
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

// ============================================================
// Heartbeat: 15초마다 현재 시간을 서버에 offTime으로 전송 (필수-1)
// PC가 갑자기 종료되어도 마지막 heartbeat 시간이 종료 시간으로 기록됨
// (최대 오차: 15초)
// 서버 측에서 isHeartbeat=true & isDesktop=true 조건으로
// 웹 로그인과 구분하여 퇴근시간 갱신 문제 방지
// ============================================================
function startHeartbeat(name) {
    if (!name) return;
    if (heartbeatInterval) {
        console.log("[Heartbeat] Already running.");
        return;
    }
    console.log("[Heartbeat] Starting heartbeat (15s interval)...");
    logToFile("[Heartbeat] Started (15s interval)");
    // 즉시 첫 번째 heartbeat 전송
    sendHeartbeat(name);
    // 15초마다 반복 전송
    heartbeatInterval = setInterval(() => sendHeartbeat(name), 15000);
}

function sendHeartbeat(name) {
    if (!name) return;
    const timeStr = formatDateTimeNow();
    const logDate = timeStr.substring(0, 10);
    
    // isHeartbeat=true 파라미터를 추가하여 서버에서 구분 가능하게 함
    sendSyncRequest('recordOff', name, timeStr, logDate, '&isHeartbeat=true').then(() => {
        console.log(`[Heartbeat] Sent offTime: ${timeStr}`);
        logToFile(`[Heartbeat] Sent offTime: ${timeStr}`);
    }).catch(err => {
        console.error("[Heartbeat] Failed:", err);
        logToFile(`[Heartbeat] Failed: ${err.message}`);
    });
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
        console.log("[Heartbeat] Stopped.");
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
        
        // 0. 로컬 캐시된 종료 시간 재전송 시도 (서버 전송 실패 복구)
        retryCachedShutdown(config.name);
        
        // 1. 과거 미전송 종료 시간 역추적 (부팅 직후)
        syncLastShutdownTime(config.name);
        
        // 2. 전체 이벤트 로그 동기화 (재부팅 구분 포함)
        setTimeout(() => {
            syncEventLogs(config.name);
        }, 3000); // 역추적 완료 후 3초 뒤 실행
        
        // 3. 실시간 종료 이벤트 감시 시작
        startShutdownWatcher(config.name);
        
        // 4. Heartbeat 시작 (60초마다 offTime 갱신 - 실시간 종료 시간 반영 핵심)
        // isHeartbeat=true & isDesktop=true 플래그로 웹 로그인과 구분하여 퇴근시간 갱신 문제 방지
        startHeartbeat(config.name);
        
        // 5. 1분마다 정기 동기화 수행 (6006 이벤트 실시간 반영)
        setInterval(() => {
            syncEventLogs(config.name);
        }, 60000);
        
        powerMonitor.on('suspend', () => {
            console.log("System suspending. Sending quick off record...");
            sendSyncShutdownRequest('recordOff', config.name);
        });

        powerMonitor.on('resume', () => {
            console.log("System resuming. Syncing event logs...");
            // 절전 복귀 시 이전 종료 이벤트 역추적
            syncLastShutdownTime(config.name);
            setTimeout(() => syncEventLogs(config.name), 2000);
            // watcher가 죽었을 수 있으므로 재시작
            startShutdownWatcher(config.name);
            // heartbeat 재시작 (절전 복귀 후 즉시 현재 시간 갱신)
            startHeartbeat(config.name);
        });

        // OS 종료/재시작 감지 (Electron의 shutdown 이벤트)
        powerMonitor.on('shutdown', () => {
            console.log("OS shutdown detected via powerMonitor.");
            isOsShutdown = true;
            if (!shutdownHandled && config.name) {
                console.log("OS shutdown detected, sending real-time offTime request immediately.");
                sendSyncShutdownRequest('recordOff', config.name);
                shutdownHandled = true;
            }
        });
    }
    
    // 시간외근무 체크 타이머 시작
    startOvertimeCheck();
});

// ============================================================
// 4층 방어: process 레벨 종료 이벤트 감지
// Windows의 SetConsoleCtrlHandler에 해당하는 Node.js 이벤트
// ============================================================
process.on('SIGTERM', () => {
    console.log('[Process] SIGTERM received.');
    if (!shutdownHandled) {
        const config = getUserConfig();
        if (config.name) {
            sendSyncShutdownRequest('recordOff', config.name);
            shutdownHandled = true;
        }
    }
});

process.on('SIGINT', () => {
    console.log('[Process] SIGINT received.');
    if (!shutdownHandled) {
        const config = getUserConfig();
        if (config.name) {
            sendSyncShutdownRequest('recordOff', config.name);
            shutdownHandled = true;
        }
    }
});

// Windows 전용: 콘솔 윈도우가 닫힐 때 이벤트
process.on('exit', () => {
    console.log('[Process] Process exiting.');
    // exit 이벤트에서는 비동기 작업 불가하므로 캐시만 저장
    if (!shutdownHandled) {
        const config = getUserConfig();
        if (config.name) {
            const timeStr = formatDateTimeNow();
            const logDate = timeStr.substring(0, 10);
            saveShutdownCache(config.name, timeStr, logDate);
        }
    }
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

let isDelayingQuit = false;

// 앱 완전 종료 전 처리
app.on('before-quit', (e) => {
    safeToQuit = true;
    
    // heartbeat 및 watcher 프로세스 정리
    stopHeartbeat();
    stopShutdownWatcher();
    
    if (!shutdownHandled) {
        const config = getUserConfig();
        if (config.name) {
            if (isQuittingFromTray) {
                // 트레이에서 "완전 종료"를 선택한 경우: 앱만 종료하므로 offTime 기록하지 않음
                console.log("App quitting from tray. Not recording offTime (app-only exit).");
            } else if (isOsShutdown) {
                // OS 종료가 감지된 경우: 이미 powerMonitor나 session-end에서 실시간 전송됨
                console.log("App quitting due to OS shutdown. offTime was already sent in real-time.");
            } else {
                // 앱만 종료되는 경우 (설치 프로그램에 의한 종료 등)
                // offTime을 기록하지 않음 — 다음 부팅 시 6006 이벤트로 정확한 종료 시간이 기록됨
                console.log("App quitting (not OS shutdown). Skipping offTime to avoid inaccurate recording.");
                console.log("The accurate shutdown time will be synced from Event ID 6006 on next boot.");
            }
            shutdownHandled = true;
        }
    }
    
    if (isOsShutdown && !isDelayingQuit) {
        e.preventDefault();
        isDelayingQuit = true;
        console.log("Delaying before-quit by 2 seconds to allow HTTP requests to complete.");
        logToFile("[before-quit] Delaying quit by 2 seconds.");
        setTimeout(() => {
            app.quit();
        }, 2000);
    }
});

app.on('session-end', (e) => {
    // OS 세션 종료 시 (로그오프, 종료, 재시작) — OS 종료 플래그 설정 및 offTime 기록
    isOsShutdown = true;
    
    if (e) e.preventDefault();
    
    if (shutdownHandled) {
        console.log("[session-end] Already handled, quitting immediately.");
        logToFile("[session-end] Already handled, quitting immediately.");
        app.quit();
        return;
    }
    
    const config = getUserConfig();
    if (config.name) {
        console.log("System session ending (logoff/shutdown/restart). Delaying quit by 2 seconds to ensure HTTP requests complete.");
        logToFile("[session-end] Delaying quit by 2 seconds.");
        sendSyncShutdownRequest('recordOff', config.name);
        shutdownHandled = true;
        
        isDelayingQuit = true; // before-quit에서의 중복 지연 방지 (필수-2)
        setTimeout(() => {
            app.quit();
        }, 2000);
    } else {
        app.quit();
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
        startHeartbeat(newName);
    }
    
    mainWindow.hide();
});

ipcMain.on('shutdown-pc', () => {
    console.log('Received shutdown-pc command from renderer.');
    const config = getUserConfig();
    if (config.name) {
        // Send sync request to ensure log is saved before shutdown if not already done
        sendSyncShutdownRequest('recordOff', config.name);
    }
    // Execute PC shutdown
    exec('shutdown /s /t 0', (error, stdout, stderr) => {
        if (error) {
            console.error(`Error shutting down: ${error.message}`);
        }
    });
});

ipcMain.on('open-dashboard', () => {
    shell.openExternal('https://fitsociety-hue.github.io/pconoff/');
});
