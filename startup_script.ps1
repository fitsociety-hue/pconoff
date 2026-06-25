# PC 부팅 시간을 가져와서 웹앱으로 전송하는 스크립트

# 1. systeminfo에서 부팅 시간 추출
$os = Get-WmiObject Win32_OperatingSystem
$bootTimeStr = $os.ConvertToDateTime($os.LastBootUpTime)
$formattedBootTime = $bootTimeStr.ToString("yyyy-MM-dd HH:mm:ss")

# 2. 웹앱 URL 설정 (본인의 GitHub Pages 주소로 변경하세요)
# 예: https://yourusername.github.io/onoff/
$webAppUrl = "https://fitsociety-hue.github.io/pconoff/"

# URL 인코딩
[System.Reflection.Assembly]::LoadWithPartialName("System.Web") | Out-Null
$encodedBootTime = [System.Web.HttpUtility]::UrlEncode($formattedBootTime)

# 최종 URL 조합
$targetUrl = "$webAppUrl`?boot_time=$encodedBootTime"

# 3. 기본 브라우저로 웹앱 실행
Start-Process $targetUrl
