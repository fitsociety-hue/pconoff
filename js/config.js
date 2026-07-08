// Google Apps Script 배포 URL (웹앱 URL)
// 1. backend/Code.gs를 Google Apps Script에 붙여넣기
// 2. 배포 -> 새 배포 -> 웹 앱 -> 액세스 권한이 있는 사용자: '모든 사용자' 로 설정 (매우 중요! CORS 오류 방지)
// 3. 발급받은 URL을 아래에 입력하세요.
const CONFIG = {
    // Apps Script 웹 앱 URL을 여기에 입력하세요.
    // 예: "https://script.google.com/macros/s/.../exec"
    GAS_URL: "https://script.google.com/macros/s/AKfycbyjuamlEgt6t5mTAafwOKhK3sKjZDSbriPsyoBljFQHY4LorAkmb7BMN0wyHVWK6rV0/exec"
};

// 모듈로 내보내지 않고 전역 변수로 사용합니다.
