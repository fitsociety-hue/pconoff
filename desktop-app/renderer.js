const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', async () => {
    const employeeNameInput = document.getElementById('employeeName');
    const saveBtn = document.getElementById('saveBtn');
    const statusMsg = document.getElementById('statusMsg');

    // 현재 설정된 이름 불러오기
    const config = await ipcRenderer.invoke('get-config');
    if (config && config.name) {
        employeeNameInput.value = config.name;
    }

    // 저장 버튼 클릭 시
    saveBtn.addEventListener('click', () => {
        const newName = employeeNameInput.value.trim();
        if (!newName) {
            alert('이름을 입력해 주세요.');
            return;
        }

        statusMsg.style.display = 'block';
        setTimeout(() => {
            statusMsg.style.display = 'none';
        }, 3000);

        // 메인 프로세스로 새 이름 전송 및 창 숨기기 요청
        ipcRenderer.send('save-config', newName);
    });
});
