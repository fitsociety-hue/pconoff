const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const CONFIG_PATH = path.join(app.getPath('userData'), 'user_config.json');
const GAS_URL = "https://script.google.com/macros/s/AKfycbxOHHpWE5IX1pikWQHni8VVW6D3NZdgHZDg7Z2sW9zRRlHV3pJUjvmPuLh_5Alq7mpx/exec";

let tray = null;
let mainWindow = null;
let isQuitting = false;

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

// 이벤트 로그 동기화 (과거 3일치 스캔)
function syncEventLogs(name) {
    if (!name) return;
    try {
        console.log("Starting event log sync...");
        // 3일 전 자정 기준
        const psCommand = `
            $days = (Get-Date).AddDays(-3).Date;
            $events = Get-WinEvent -FilterHashtable @{LogName='System'; Id=1,12,6005,6009,7001,1074,6006,6008,42; StartTime=$days} -ErrorAction SilentlyContinue | Select-Object TimeCreated, Id;
            if ($events) { $events | ConvertTo-Json -Compress } else { "[]" }
        `;
        exec(`powershell -Command "${psCommand}"`, { encoding: 'utf-8', maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                console.error("Failed to execute PowerShell command", error);
                return;
            }
            
            const output = stdout.trim();
            if (!output || output === '') return;
            
            try {
                const rawEvents = JSON.parse(output);
                const events = (Array.isArray(rawEvents) ? rawEvents : [rawEvents]).map(e => {
                    const match = e.TimeCreated.match(/\\\/Date\((\d+)\)\\\//);
                    const ts = match ? parseInt(match[1], 10) : 0;
                    return { time: ts, id: e.Id };
                }).filter(e => e.time > 0);
                
                // 시간순 정렬 (오름차순)
                events.sort((a, b) => a.time - b.time);
                
                const bootIds = [1, 12, 6005, 6009, 7001];
                const offIds = [1074, 6006, 6008, 42];
                
                const dailyLogs = {};
                
                const pad = (n) => n.toString().padStart(2, '0');
                const getKSTDateString = (dateObj) => {
                    const kst = new Date(dateObj.toLocaleString("en-US", {timeZone: "Asia/Seoul"}));
                    return `${kst.getFullYear()}-${pad(kst.getMonth()+1)}-${pad(kst.getDate())}`;
                };
                const getKSTTimeString = (dateObj) => {
                    const kst = new Date(dateObj.toLocaleString("en-US", {timeZone: "Asia/Seoul"}));
                    return `${kst.getFullYear()}-${pad(kst.getMonth()+1)}-${pad(kst.getDate())} ${pad(kst.getHours())}:${pad(kst.getMinutes())}:${pad(kst.getSeconds())}`;
                };

                events.forEach(e => {
                    const d = new Date(e.time);
                    const dateStr = getKSTDateString(d);
                    const timeStr = getKSTTimeString(d);
                    
                    if (!dailyLogs[dateStr]) {
                        dailyLogs[dateStr] = { bootTime: null, offTime: null };
                    }
                    
                    if (bootIds.includes(e.id)) {
                        if (!dailyLogs[dateStr].bootTime) {
                            dailyLogs[dateStr].bootTime = timeStr;
                        }
                    } else if (offIds.includes(e.id)) {
                        dailyLogs[dateStr].offTime = timeStr;
                    }
                });
                
                console.log("Parsed daily logs:", dailyLogs);
                
                for (const [dateStr, log] of Object.entries(dailyLogs)) {
                    if (log.bootTime) {
                        const url = `${GAS_URL}?action=recordBoot&name=${encodeURIComponent(name)}&bootTime=${encodeURIComponent(log.bootTime)}&logDate=${encodeURIComponent(dateStr)}&isDesktop=true&t=${Date.now()}`;
                        exec(`powershell -Command "Invoke-RestMethod -Uri '${url}'"`, () => {});
                    }
                    if (log.offTime) {
                        const url = `${GAS_URL}?action=recordOff&name=${encodeURIComponent(name)}&offTime=${encodeURIComponent(log.offTime)}&logDate=${encodeURIComponent(dateStr)}&isDesktop=true&t=${Date.now()}`;
                        exec(`powershell -Command "Invoke-RestMethod -Uri '${url}'"`, () => {});
                    }
                }
            } catch (e) {
                console.error("JSON parse error for event logs", e);
            }
        });
    } catch (e) {
        console.error("Failed to sync event logs", e);
    }
}

// 동기 방식으로 GAS에 현재 시간 요청 전송 (종료/절전 시 즉각 반응용)
function sendSyncRequest(action, name) {
    if (!name) return;
    try {
        const now = new Date();
        const pad = (n) => n.toString().padStart(2, '0');
        const timeStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        
        const timeParam = action === 'recordBoot' ? `bootTime=${encodeURIComponent(timeStr)}` : `offTime=${encodeURIComponent(timeStr)}`;
        const url = `${GAS_URL}?action=${action}&name=${encodeURIComponent(name)}&${timeParam}&isDesktop=true&t=${Date.now()}`;
        
        // Windows 환경에서 동기적으로 HTTP 요청 보내기 (최대 5초 대기)
        try {
            // 빠르고 안정적인 curl 우선 사용 (네트워크 종료 직전에 성공 확률 높임)
            execSync(`curl.exe -s -L "${url}"`, { timeout: 3000, stdio: 'ignore' });
            console.log(`Successfully sent ${action} for ${name} (Sync Fallback - curl)`);
        } catch(e) {
            execSync(`powershell -Command "Invoke-RestMethod -Uri '${url}'"`, { timeout: 3000, stdio: 'ignore' });
            console.log(`Successfully sent ${action} for ${name} (Sync Fallback - powershell)`);
        }
    } catch (e) {
        console.error(`Failed to send ${action}`, e);
    }
}

function createTray() {
    // 임시로 기본 아이콘 대신 null 처리 또는 나중에 아이콘 파일 추가 시 사용
    // 아이콘이 없으면 에러가 나므로, 내장 아이콘 사용 우회
    tray = new Tray(path.join(__dirname, 'icon.png'));
    const contextMenu = Menu.buildFromTemplate([
        { label: '설정 열기', click: () => mainWindow.show() },
        { label: '근태 대시보드 열기(웹)', click: () => shell.openExternal('https://fitsociety-hue.github.io/pconoff/') },
        { type: 'separator' },
        { 
            label: '완전 종료', 
            click: () => {
                isQuitting = true;
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
        if (!isQuitting) {
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
    // 트레이 아이콘 파일이 없을 때 앱이 터지지 않도록 예외 처리
    try {
        createTray();
    } catch(e) { console.error("Tray error (missing icon?)"); }
    
    createWindow();

    const config = getUserConfig();
    if (!config.name) {
        // 이름 설정이 안 되어있으면 창을 띄움
        mainWindow.show();
    } else {
        // 이름이 설정되어 있으면 부팅 시 이벤트 로그 스캔을 통해 전송
        console.log("Starting event log sync on boot...");
        syncEventLogs(config.name);
        
        // 1시간 마다 이벤트 로그를 스캔하여 오프라인 기록 등 보완
        setInterval(() => {
            syncEventLogs(config.name);
        }, 3600000);
        
        powerMonitor.on('suspend', () => {
            console.log("System suspending. Sending quick off record...");
            sendSyncRequest('recordOff', config.name);
        });

        powerMonitor.on('resume', () => {
            console.log("System resuming. Syncing event logs...");
            syncEventLogs(config.name);
        });
    }
    
    // 시간외근무 체크 타이머 시작
    startOvertimeCheck();
});

// 하루에 한 번만 체크하기 위한 플래그
let overtimeCheckedToday = false;

function startOvertimeCheck() {
    // 1분(60000ms)마다 현재 시간 확인
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
                // '미신청' 버튼 (인덱스 1)
                if (result.response === 1) {
                    dialog.showMessageBox({
                        type: 'warning',
                        buttons: ['확인'],
                        title: '퇴근 독려',
                        message: '시간외근무 미신청자입니다.\n신속히 PC를 종료하고 퇴근해주시기 바랍니다.'
                    });
                }
            });
        }
        
        // 자정이 지나면 플래그 리셋
        if (hour === 0 && minute === 0) {
            overtimeCheckedToday = false;
        }
    }, 60000);
}

// Windows 시스템 종료 감지 로직
let shutdownHandled = false;

// before-quit은 사용자가 앱을 명시적으로 종료할 때 호출됨
app.on('before-quit', (e) => {
    if (shutdownHandled) return;
    
    const config = getUserConfig();
    if (config.name) {
        console.log("System shutting down. Sending off record...");
        // 서버에 퇴근 시간 기록
        sendSyncRequest('recordOff', config.name);
        shutdownHandled = true;
    }
});

// session-end는 Windows가 종료, 재시작, 로그오프 될 때 호출되어 더 확실하게 감지됨
app.on('session-end', () => {
    if (shutdownHandled) return;
    
    const config = getUserConfig();
    if (config.name) {
        console.log("System session ending. Sending off record...");
        sendSyncRequest('recordOff', config.name);
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
    
    // 처음 설정한 경우 즉시 부팅 기록 스캔
    if (isFirstTime && newName) {
        syncEventLogs(newName);
    }
    
    mainWindow.hide();
});

ipcMain.on('open-dashboard', () => {
    shell.openExternal('https://fitsociety-hue.github.io/pconoff/');
});
