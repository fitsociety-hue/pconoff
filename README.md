# PC 접속시간 모니터링 시스템 (ON/OFF)

Windows PC의 부팅 시간과 마지막 종료 시간을 관리하는 근태보조 웹앱입니다.

## 🚀 배포 방법

### 1. Google Apps Script (백엔드) 설정

1. Google Drive에서 새로 만들기 > Google 스프레드시트 생성
2. 상단 메뉴의 **확장 프로그램 > Apps Script** 클릭
3. `backend/Code.gs`의 내용을 복사하여 붙여넣기
4. **배포 > 새 배포** 클릭
5. 유형 선택 톱니바퀴 > **웹 앱** 선택
6. **액세스 권한이 있는 사용자**를 "강동어울림복지관의 모든 사용자" (또는 "모든 사용자")로 설정
7. **배포** 클릭 후 나타나는 **웹 앱 URL** 복사
8. 복사한 URL을 `js/config.js` 파일 안의 `CONFIG.GAS_URL` 값으로 교체

### 2. GitHub Pages (프론트엔드) 설정

1. 이 프로젝트를 자신의 GitHub 레포지토리에 푸시(Push)
2. 레포지토리의 **Settings > Pages** 메뉴로 이동
3. Source를 **Deploy from a branch**로 선택하고, Branch를 **main**, 폴더를 **/ (root)**로 지정 후 Save
4. 수 분 후 GitHub Pages 주소(예: `https://아이디.github.io/레포지토리명/`)가 활성화됩니다.
5. 이 주소를 `startup_script.ps1`의 `$webAppUrl` 값으로 변경

### 3. PC 연동 (시작프로그램 등록)

1. `startup_script.ps1` 파일을 다운로드 (내부의 `$webAppUrl`이 수정된 상태여야 함)
2. `Win + R` 키를 누르고 `shell:startup` 입력 후 엔터
3. 열린 시작프로그램 폴더에 위 스크립트를 배치 (또는 이 스크립트를 실행하는 `.bat` 바로가기 배치)
   - `.bat` 파일 내용 예시:
     `powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\경로\startup_script.ps1"`
4. 이제 PC를 켜면 부팅 시간이 파라미터로 붙어서 웹앱이 자동으로 열립니다.

## 🔑 주요 계정 정보

- **관리자 초기 접속**
  - 아이디: `admin`
  - 비밀번호: `2026`
  - (접속 후 반드시 관리자 대시보드에서 비밀번호를 변경하세요)
