const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const CONFIG_PATH = path.join(app.getPath('userData'), 'user_config.json');
const GAS_URL = "https://script.google.com/macros/s/AKfycbxCRx5X2vQEoo-kL7XtirKSQoqmHfVOtKTlWE10fAuZQlGtq6eKcQEfFHbnXfcCKonu/exec";

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

// Windows 이벤트 로그(6005, 6009, 1074, 6006, 6008)를 통해 부팅/종료 시간 추출
function getEventLogTime(type) {
    try {
        let psCommand = '';
        if (type === 'boot') {
            psCommand = `$today = (Get-Date).Date; $events = Get-WinEvent -FilterHashtable @{LogName='System'; Id=1,12,6005,6009,7001; StartTime=$today} -ErrorAction SilentlyContinue; if ($events) { $events | Sort-Object TimeCreated | Select-Object -First 1 -ExpandProperty TimeCreated | Get-Date -Format 'yyyy-MM-dd HH:mm:ss' } else { Get-Date -Format 'yyyy-MM-dd HH:mm:ss' }`;
        } else if (type === 'off') {
            psCommand = `$events = Get-WinEvent -FilterHashtable @{LogName='System'; Id=1074,6006,6008} -MaxEvents 1 -ErrorAction SilentlyContinue; if ($events) { $events | Select-Object -ExpandProperty TimeCreated | Get-Date -Format 'yyyy-MM-dd HH:mm:ss' }`;
        }
        
        if (psCommand) {
            const output = execSync(`powershell -Command "${psCommand}"`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            if (output) return output;
        }
    } catch (e) {
        console.error(`Failed to get ${type} event log time`, e);
    }
    
    // Fallback: 현재 시간
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// 동기 방식으로 GAS에 요청 전송 (종료 시 필요)
function sendSyncRequest(action, name) {
    if (!name) return;
    try {
        let timeStr;
        if (action === 'recordBoot') {
            timeStr = getEventLogTime('boot');
        } else {
            timeStr = getEventLogTime('off');
        }
        
        const timeParam = action === 'recordBoot' ? `bootTime=${encodeURIComponent(timeStr)}` : `offTime=${encodeURIComponent(timeStr)}`;
        const url = `${GAS_URL}?action=${action}&name=${encodeURIComponent(name)}&${timeParam}&isDesktop=true&t=${Date.now()}`;
        
        // Windows 환경에서 동기적으로 HTTP 요청 보내기 (최대 5초 대기)
        execSync(`powershell -Command "Invoke-RestMethod -Uri '${url}'"`, { timeout: 5000, stdio: 'ignore' });
        console.log(`Successfully sent ${action} for ${name}`);
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
        // 이름이 설정되어 있으면 부팅 기록 전송
        console.log("Sending boot record...");
        sendSyncRequest('recordBoot', config.name);
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
    
    // 처음 설정한 경우 즉시 부팅 기록 전송
    if (isFirstTime && newName) {
        sendSyncRequest('recordBoot', newName);
    }
    
    mainWindow.hide();
});

ipcMain.on('open-dashboard', () => {
    shell.openExternal('https://fitsociety-hue.github.io/pconoff/');
});
