// SHA-256 해시 함수 (비밀번호 암호화용)
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 0으로 시작하는 문자열 그대로 유지 (ex: "0579")
function validatePassword(pw) {
    const regex = /^[0-9]{4}$/;
    return regex.test(pw);
}

// URL 파라미터 가져오기
function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
}

// 현재 시간 포맷 (YYYY-MM-DD HH:mm:ss)
function formatDateTime(date) {
    const pad = (n) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

document.addEventListener('DOMContentLoaded', async () => {
    
    // 페이지 라우팅 로직 (현재 파일명 기반)
    const path = window.location.pathname;
    const isDashboard = path.includes('dashboard.html');
    const isAdmin = path.includes('admin.html');
    const isIndex = path.endsWith('/') || path.includes('index.html');

    const currentUser = JSON.parse(localStorage.getItem('user'));
    const bootTimeParam = getQueryParam('boot_time'); // 시작프로그램에서 넘겨준 파라미터

    if (isIndex) {
        if (currentUser) {
            // 이미 로그인된 상태이면 대시보드로 이동
            // 파라미터로 boot_time이 들어왔다면 대시보드로 이동할 때 같이 넘겨줄 수 있도록 처리
            if (bootTimeParam) {
                window.location.href = `dashboard.html?boot_time=${bootTimeParam}`;
            } else {
                window.location.href = 'dashboard.html';
            }
            return;
        }

        // 로그인 버튼
        const loginBtn = document.getElementById('loginBtn');
        if (loginBtn) {
            loginBtn.addEventListener('click', async () => {
                const name = document.getElementById('name').value;
                const password = document.getElementById('password').value;
                
                if (!name || !password) {
                    alert('이름과 비밀번호를 입력해주세요.');
                    return;
                }

                if (!validatePassword(password)) {
                    alert('비밀번호는 숫자 4자리여야 합니다. (예: 0579)');
                    return;
                }

                loginBtn.disabled = true;
                loginBtn.textContent = '로그인 중...';

                const hash = await sha256(password);
                
                try {
                    const url = `${CONFIG.GAS_URL}?action=login&name=${encodeURIComponent(name)}&password=${encodeURIComponent(hash)}&t=${Date.now()}`;
                    const response = await fetch(url);
                    const result = await response.json();
                    
                    if (result.status === 'success') {
                        localStorage.setItem('user', JSON.stringify(result.user));
                        if (bootTimeParam) {
                            window.location.href = `dashboard.html?boot_time=${bootTimeParam}`;
                        } else {
                            window.location.href = 'dashboard.html';
                        }
                    } else {
                        alert(result.message);
                    }
                } catch (e) {
                    alert('서버 연결 오류가 발생했습니다.');
                } finally {
                    loginBtn.disabled = false;
                    loginBtn.textContent = '로그인';
                }
            });
        }

        // 회원가입 폼 전환
        const showRegisterBtn = document.getElementById('showRegisterBtn');
        const showLoginBtn = document.getElementById('showLoginBtn');
        if (showRegisterBtn) {
            showRegisterBtn.addEventListener('click', (e) => {
                e.preventDefault();
                document.getElementById('loginForm').classList.add('hidden');
                document.getElementById('registerForm').classList.remove('hidden');
            });
        }
        if (showLoginBtn) {
            showLoginBtn.addEventListener('click', (e) => {
                e.preventDefault();
                document.getElementById('registerForm').classList.add('hidden');
                document.getElementById('loginForm').classList.remove('hidden');
            });
        }

        // 회원가입 버튼
        const registerBtn = document.getElementById('registerBtn');
        if (registerBtn) {
            registerBtn.addEventListener('click', async () => {
                const team = document.getElementById('regTeam').value;
                const name = document.getElementById('regName').value;
                const role = document.getElementById('regRole').value;
                const password = document.getElementById('regPassword').value;

                if (!team || !name || !role || !password) {
                    alert('모든 필드를 입력해주세요.');
                    return;
                }

                if (!validatePassword(password)) {
                    alert('비밀번호는 반드시 숫자 4자리로 입력해야 합니다. (예: 0579)');
                    return;
                }

                registerBtn.disabled = true;
                registerBtn.textContent = '처리 중...';

                const hash = await sha256(password);

                try {
                    const url = `${CONFIG.GAS_URL}?action=register&team=${encodeURIComponent(team)}&name=${encodeURIComponent(name)}&role=${encodeURIComponent(role)}&password=${encodeURIComponent(hash)}&t=${Date.now()}`;
                    const response = await fetch(url);
                    const result = await response.json();
                    
                    if (result.status === 'success') {
                        alert('회원가입이 완료되었습니다. 로그인해주세요.');
                        document.getElementById('registerForm').classList.add('hidden');
                        document.getElementById('loginForm').classList.remove('hidden');
                    } else {
                        alert(result.message);
                    }
                } catch (e) {
                    alert('서버 연결 오류가 발생했습니다.');
                } finally {
                    registerBtn.disabled = false;
                    registerBtn.textContent = '회원가입';
                }
            });
        }

    } else if (isDashboard) {
        if (!currentUser) {
            window.location.href = 'index.html';
            return;
        }

        document.getElementById('userNameDisplay').textContent = `${currentUser.team} ${currentUser.name} ${currentUser.role}`;

        // 출근 기록 전송 로직 (최초 진입 시)
        let actualBootTime = bootTimeParam;
        if (!actualBootTime) {
            actualBootTime = formatDateTime(new Date()); // 파라미터가 없으면 현재 시간을 출근 시간으로 간주
        }

        // 출근 시간 표시 로직 (현재 시간 대신 출근 시간 고정)
        document.getElementById('currentTime').textContent = `출근(PC 켠 시간): ${actualBootTime}`;
        
        try {
            const url = `${CONFIG.GAS_URL}?action=recordBoot&name=${encodeURIComponent(currentUser.name)}&bootTime=${encodeURIComponent(actualBootTime)}&t=${Date.now()}`;
            const response = await fetch(url);
            // 성공 여부 로깅 안함 (이미 등록되어 있으면 패스)
        } catch (e) {
            console.error(e);
        }

        // 브라우저/탭 종료 시 자동 퇴근 기록 (sendBeacon 사용)
        window.addEventListener('beforeunload', () => {
            const offTime = formatDateTime(new Date());
            // navigator.sendBeacon은 POST 요청을 보내므로 Code.gs의 doPost에 recordOff를 추가해 두었음
            const url = `${CONFIG.GAS_URL}?action=recordOff&name=${encodeURIComponent(currentUser.name)}&offTime=${encodeURIComponent(offTime)}&t=${Date.now()}`;
            navigator.sendBeacon(url);
        });

        // 퇴근 버튼 로직
        const offBtn = document.getElementById('offBtn');
        if (offBtn) {
            offBtn.addEventListener('click', async () => {
                if(!confirm('퇴근을 기록하시겠습니까? 기록 후 창을 닫아주세요.')) return;
                
                const offTime = formatDateTime(new Date());
                offBtn.disabled = true;
                offBtn.textContent = '기록 중...';

                try {
                    const url = `${CONFIG.GAS_URL}?action=recordOff&name=${encodeURIComponent(currentUser.name)}&offTime=${encodeURIComponent(offTime)}&t=${Date.now()}`;
                    const response = await fetch(url);
                    const result = await response.json();
                    if(result.status === 'success') {
                        alert('퇴근이 기록되었습니다. 수고하셨습니다!');
                        localStorage.removeItem('user'); // 로그아웃 처리
                        window.location.href = 'index.html';
                    } else {
                        alert(result.message);
                        offBtn.disabled = false;
                        offBtn.textContent = '퇴근하기 (종료)';
                    }
                } catch (e) {
                    alert('오류가 발생했습니다.');
                    offBtn.disabled = false;
                    offBtn.textContent = '퇴근하기 (종료)';
                }
            });
        }

        // 로그아웃 버튼
        const logoutBtn = document.getElementById('logoutBtn');
        if(logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                localStorage.removeItem('user');
                window.location.href = 'index.html';
            });
        }



        // 나의 근태 기록 로드
        let allUserLogs = [];
        async function loadUserLogs() {
            const tbody = document.getElementById('userLogTableBody');
            if(!tbody) return;
            
            try {
                const url = `${CONFIG.GAS_URL}?action=getStats&t=${Date.now()}`;
                const response = await fetch(url);
                const result = await response.json();
                
                if(result.status === 'success') {
                    // 현재 사용자 기록만 필터링
                    allUserLogs = result.data.filter(row => row.name === currentUser.name);
                    renderUserLogs('all');
                } else {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:red;">불러오기 실패</td></tr>';
                }
            } catch(e) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:red;">통신 오류</td></tr>';
            }
        }

        function renderUserLogs(filterType) {
            const tbody = document.getElementById('userLogTableBody');
            if(!tbody) return;
            
            const formatTime = (timeStr) => {
                if (!timeStr || timeStr === '-') return '-';
                try {
                    const d = new Date(timeStr);
                    if (isNaN(d.getTime())) return timeStr;
                    return d.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
                } catch(e) { return timeStr; }
            };
            const formatOnlyDate = (timeStr) => {
                if (!timeStr || timeStr === '-') return '-';
                try {
                    const d = new Date(timeStr);
                    if (isNaN(d.getTime())) return timeStr;
                    return d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
                } catch(e) { return timeStr; }
            };

            const now = new Date();
            const startOfDay = new Date(now);
            startOfDay.setHours(0,0,0,0);
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday as start
            startOfWeek.setHours(0,0,0,0);
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            startOfMonth.setHours(0,0,0,0);

            let html = '';
            
            const groupedLogs = {};
            allUserLogs.forEach(row => {
                const dateKey = formatOnlyDate(row.date);
                if (!dateKey || dateKey === '-') return;
                
                let isBootValid = true;
                if (row.bootTime && row.bootTime !== '-') {
                    const rowDateMs = new Date(row.date).setHours(0,0,0,0);
                    const bootMs = new Date(row.bootTime).getTime();
                    if (!isNaN(rowDateMs) && !isNaN(bootMs)) {
                        if (bootMs < rowDateMs - (24 * 60 * 60 * 1000)) {
                            isBootValid = false;
                        }
                    }
                }
                const safeBootTime = isBootValid ? row.bootTime : '-';
                
                if (!groupedLogs[dateKey]) {
                    groupedLogs[dateKey] = { date: row.date, bootTime: safeBootTime, offTime: row.offTime };
                } else {
                    const currentBoot = new Date(groupedLogs[dateKey].bootTime).getTime();
                    const rowBoot = new Date(safeBootTime).getTime();
                    if (!isNaN(rowBoot) && (isNaN(currentBoot) || rowBoot < currentBoot)) {
                        groupedLogs[dateKey].bootTime = safeBootTime;
                    }
                    
                    const currentOff = new Date(groupedLogs[dateKey].offTime).getTime();
                    const rowOff = new Date(row.offTime).getTime();
                    if (!isNaN(rowOff) && (isNaN(currentOff) || rowOff > currentOff)) {
                        groupedLogs[dateKey].offTime = row.offTime;
                    }
                }
            });
            const processedLogs = Object.values(groupedLogs).sort((a,b) => new Date(a.date) - new Date(b.date));
            
            // 대시보드 메인 화면의 출근 시간을 서버에서 불러온 진짜 출근 시간으로 갱신
            const todayStr = formatOnlyDate(formatDateTime(new Date()));
            if (groupedLogs[todayStr] && groupedLogs[todayStr].bootTime !== '-') {
                const mainTimeDisplay = document.getElementById('currentTime');
                if (mainTimeDisplay) {
                    mainTimeDisplay.textContent = `출근(PC 켠 시간): ${formatTime(groupedLogs[todayStr].bootTime)}`;
                }
            }
            
            processedLogs.slice().reverse().forEach(row => {
                let rowDate;
                try {
                    rowDate = new Date(row.date);
                } catch(e) {}
                
                if (rowDate && !isNaN(rowDate.getTime())) {
                    if (filterType === 'daily' && rowDate < startOfDay) return;
                    if (filterType === 'weekly' && rowDate < startOfWeek) return;
                    if (filterType === 'monthly' && rowDate < startOfMonth) return;
                }
                
                html += `
                    <tr>
                        <td style="white-space: nowrap;">${formatOnlyDate(row.date)}</td>
                        <td style="white-space: nowrap;">${formatTime(row.bootTime)}</td>
                        <td style="white-space: nowrap;">${formatTime(row.offTime)}</td>
                    </tr>
                `;
            });

            if(!html) html = '<tr><td colspan="3" style="text-align:center;">기록이 없습니다.</td></tr>';
            tbody.innerHTML = html;
        }

        const userLogFilter = document.getElementById('userLogFilter');
        if (userLogFilter) {
            userLogFilter.addEventListener('change', (e) => {
                renderUserLogs(e.target.value);
            });
            // 초기 로드
            loadUserLogs();
        }
    }

});
