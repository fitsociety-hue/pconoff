// Google Apps Script 배포 URL (웹앱 URL)
// 1. backend/Code.gs를 Google Apps Script에 붙여넣기
// 2. 배포 -> 새 배포 -> 웹 앱 -> 액세스 권한이 있는 사용자: '모든 사용자' 로 설정 (매우 중요! CORS 오류 방지)
// 3. 발급받은 URL을 아래에 입력하세요.
const CONFIG = {
    GAS_URL: "https://script.google.com/macros/s/AKfycbypVqiPUraYYDqFYkCfZws0vExl_3YPNUDqFusmfHFKfiEeH0kOzod2ac-ymfhfqbIx/exec"
};
