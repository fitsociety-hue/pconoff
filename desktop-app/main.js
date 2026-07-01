const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, shell, powerMonitor, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');

const CONFIG_PATH = path.join(app.getPath('userData'), 'user_config.json');
const GAS_URL = "https://script.google.com/macros/s/AKfycbxOHHpWE5IX1pikWQHni8VVW6D3NZdgHZDg7Z2sW9zRRlHV3pJUjvmPuLh_5Alq7mpx/exec";

let tray = null;
let mainWindow = null;
let isQuitting = false;
let isQuittingFromTray = false;
let safeToQuit = false;
let shutdownHandled = false;

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

// HTTP GET 요청 (순차 전송용)
function sendSyncRequest(action, name, timeStr = null, logDate = null) {
    if (!name) return Promise.resolve();
    
    return new Promise((resolve, reject) => {
        const now = new Date();
        const pad = (n) => n.toString().padStart(2, '0');
        
        if (!timeStr) {
            timeStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        }
        if (!logDate) {
            logDate = timeStr.substring(0, 10);
        }
        
        const timeParam = action === 'recordBoot' ? `bootTime=${encodeURIComponent(timeStr)}` : `offTime=${encodeURIComponent(timeStr)}`;
        const urlString = `${GAS_URL}?action=${action}&name=${encodeURIComponent(name)}&${timeParam}&logDate=${encodeURIComponent(logDate)}&isDesktop=true&t=${Date.now()}`;
        
        console.log(`Sending ${action} for ${name} at ${timeStr}`);
        
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
        const now = new Date();
        const pad = (n) => n.toString().padStart(2, '0');
        const timeStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        const logDate = timeStr.substring(0, 10);
        
        const timeParam = action === 'recordBoot' ? `bootTime=${encodeURIComponent(timeStr)}` : `offTime=${encodeURIComponent(timeStr)}`;
        const url = `${GAS_URL}?action=${action}&name=${encodeURIComponent(name)}&${timeParam}&logDate=${encodeURIComponent(logDate)}&isDesktop=true&t=${Date.now()}`;
        
        // 최대 3초 대기하며 동기적으로 실행 (OS 종료 지연 유도 및 네트워크 전송 보장)
        execSync(`curl.exe -s -L -m 3 "${url}"`, { windowsHide: true, timeout: 3000 });
        console.log(`Successfully sent sync request for ${action} for ${name}`);
    } catch(e) {
        console.error("Sync shutdown request failed", e);
    }
}

// 이벤트 로그 동기화 (과거 2일치 스캔 - 동시성 문제 방지)
function syncEventLogs(name) {
    if (!name) return;
    console.log("Starting event log sync...");
    
    // 2일 전(172,800,000ms) 기준
    const command = `wevtutil qe System /q:"*[System[TimeCreated[timediff(@SystemTime) <= 172800000] and ((EventID=1 and Provider[@Name='Microsoft-Windows-Power-Troubleshooter']) or EventID=12 or EventID=6005 or EventID=6009 or EventID=7001 or EventID=7002 or EventID=1074 or EventID=6006 or EventID=6008 or EventID=42)]]" /f:xml`;
    
    exec(command, { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 5 }, async (error, stdout, stderr) => {
        if (error) {
            console.error("Failed to execute wevtutil command", error);
            return;
        }
        
        if (!stdout || stdout.trim() === '') return;
        
        try {
            const eventBlocks = stdout.split('</Event>');
            const events = [];
            for (const block of eventBlocks) {
                const idMatch = block.match(/<EventID(?:[^>]*)>(\d+)<\/EventID>/);
                const timeMatch = block.match(/<TimeCreated SystemTime='([^']+)'/);
                if (idMatch && timeMatch) {
                    const id = parseInt(idMatch[1], 10);
                    const dateObj = new Date(timeMatch[1]);
                    const kstDate = new Date(dateObj.getTime() + (9 * 60 * 60 * 1000));
                    const pad = (n) => n.toString().padStart(2, '0');
                    const timeStr = `${kstDate.getUTCFullYear()}-${pad(kstDate.getUTCMonth()+1)}-${pad(kstDate.getUTCDate())} ${pad(kstDate.getUTCHours())}:${pad(kstDate.getUTCMinutes())}:${pad(kstDate.getUTCSeconds())}`;
                    events.push({ Id: id, Time: timeStr });
                }
            }
            
            // 시간순 정렬 (오름차순)
            events.sort((a, b) => a.Time.localeCompare(b.Time));
            
            const bootIds = [12, 6005, 6009, 7001];
            const offIds = [1074, 6006, 42, 7002]; // EventID 6008(비정상종료 후 부팅시 생성) 제외
            
            const dailyLogs = {};
            
            events.forEach(e => {
                const dateStr = e.Time.substring(0, 10);
                
                if (!dailyLogs[dateStr]) {
                    dailyLogs[dateStr] = { bootTime: null, offTime: null };
                }
                
                if (bootIds.includes(e.Id) || e.Id === 1) {
                    // 가장 빠른 시간을 부팅 시간으로 기록 (최초 발견 시)
                    if (!dailyLogs[dateStr].bootTime) {
                        dailyLogs[dateStr].bootTime = e.Time;
                    }
                } else if (offIds.includes(e.Id)) {
                    // 덮어씌워지며 최종적으로 가장 마지막 시간이 오프 시간으로 기록됨
                    dailyLogs[dateStr].offTime = e.Time;
                }
            });
            
            console.log("Parsed daily logs:", dailyLogs);
            
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
        } catch (e) {
            console.error("Parse error for event logs", e);
        }
    });
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
        syncEventLogs(config.name);
        
        // 1시간 마다 동기화 수행
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
});

app.on('session-end', () => {
    if (shutdownHandled) return;
    
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
    }
    
    mainWindow.hide();
});

ipcMain.on('open-dashboard', () => {
    shell.openExternal('https://fitsociety-hue.github.io/pconoff/');
});
