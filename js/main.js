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

        // 현재 시간 표시 로직
        setInterval(() => {
            document.getElementById('currentTime').textContent = formatDateTime(new Date());
            checkOvertime();
        }, 1000);

        // 출근 기록 전송 로직 (최초 진입 시)
        let actualBootTime = bootTimeParam;
        if (!actualBootTime) {
            actualBootTime = formatDateTime(new Date()); // 파라미터가 없으면 현재 시간을 출근 시간으로 간주
        }
        
        try {
            const url = `${CONFIG.GAS_URL}?action=recordBoot&name=${encodeURIComponent(currentUser.name)}&bootTime=${encodeURIComponent(actualBootTime)}&t=${Date.now()}`;
            const response = await fetch(url);
            // 성공 여부 로깅 안함 (이미 등록되어 있으면 패스)
        } catch (e) {
            console.error(e);
        }

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

        // 시간외근무 모달 관련
        const overtimeModal = document.getElementById('overtimeModal');
        let overtimePrompted = false;

        function checkOvertime() {
            const now = new Date();
            // 18시 10분 이후 && 아직 프롬프트 안 띄움
            if (now.getHours() >= 18 && now.getMinutes() >= 10 && !overtimePrompted) {
                overtimePrompted = true;
                overtimeModal.classList.add('active');
            }
        }

        document.getElementById('applyOvertimeBtn').addEventListener('click', async () => {
            try {
                const url = `${CONFIG.GAS_URL}?action=applyOvertime&name=${encodeURIComponent(currentUser.name)}&t=${Date.now()}`;
                await fetch(url);
                alert('시간외근무 신청이 완료되었습니다.');
                overtimeModal.classList.remove('active');
            } catch(e) {
                alert('오류 발생');
            }
        });

        document.getElementById('declineOvertimeBtn').addEventListener('click', () => {
            alert('업무시간이 종료되었습니다. 신속한 퇴근을 독려합니다!');
            overtimeModal.classList.remove('active');
        });

        // 내 근태 기록 로드
        async function loadMyStats() {
            const tbody = document.getElementById('myStatsTableBody');
            try {
                const url = `${CONFIG.GAS_URL}?action=getMyStats&name=${encodeURIComponent(currentUser.name)}&t=${Date.now()}`;
                const response = await fetch(url);
                const result = await response.json();
                
                if(result.status === 'success') {
                    let html = '';
                    // 최신순 렌더링
                    result.data.reverse().forEach(row => {
                        html += `
                            <tr style="border-bottom: 1px solid rgba(0,0,0,0.1);">
                                <td style="padding: 10px;">${row.date}</td>
                                <td style="padding: 10px;">${row.bootTime ? row.bootTime.split(' ')[1] || row.bootTime : '-'}</td>
                                <td style="padding: 10px;">${row.offTime ? row.offTime.split(' ')[1] || row.offTime : '-'}</td>
                                <td style="padding: 10px;">${row.overtime === 'Yes' ? '<span style="color:var(--error-color);font-weight:bold;">O</span>' : '-'}</td>
                            </tr>
                        `;
                    });
                    if(!html) html = '<tr><td colspan="4" style="text-align:center; padding: 10px;">기록이 없습니다.</td></tr>';
                    tbody.innerHTML = html;
                } else {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 10px; color:red;">불러오기 실패</td></tr>';
                }
            } catch(e) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 10px; color:red;">통신 오류</td></tr>';
            }
        }
        
        // 페이지 로드 시 기록 가져오기
        loadMyStats();
    }

});
