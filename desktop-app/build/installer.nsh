!macro customInit
  ; 프로세스 강제 종료
  nsExec::Exec 'taskkill /F /IM "onoff-monitor.exe" /T'
  Pop $0
  nsExec::Exec 'taskkill /F /IM "출퇴근기록앱.exe" /T'
  Pop $0
  
  ReadRegStr $R0 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ReadRegStr $R1 HKCU "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
  
  ${If} $R0 == ""
    ReadRegStr $R0 HKLM "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    ReadRegStr $R1 HKLM "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
  ${EndIf}
  
  ${If} $R0 != ""
    MessageBox MB_YESNOCANCEL|MB_ICONQUESTION "출퇴근기록앱이 이미 설치되어 있습니다. 원하시는 작업을 선택해주세요.$\n$\n[예] 기존 앱 및 데이터 완전 삭제 후 새로 설치 진행$\n[아니오] 업데이트 / 덮어쓰기 설치 진행$\n[취소] 설치 취소" /SD IDNO IDYES do_uninstall IDCANCEL do_cancel
    
    Goto do_continue
    
    do_uninstall:
      ; Run uninstaller silently and wait for it
      ExecWait '$R0 /S _?=$R1'
      
      ; Force delete app data and remnants
      RMDir /r "$APPDATA\onoff-monitor"
      RMDir /r "$LOCALAPPDATA\onoff-monitor"
      RMDir /r "$LOCALAPPDATA\onoff-monitor-updater"
      
      ; Continue installation instead of quitting
      Goto do_continue
      
    do_cancel:
      Quit
      
    do_continue:
  ${EndIf}
!macroend

!macro customUnInstall
  ; 프로세스 강제 종료
  nsExec::Exec 'taskkill /F /IM "onoff-monitor.exe" /T'
  Pop $0
  nsExec::Exec 'taskkill /F /IM "출퇴근기록앱.exe" /T'
  Pop $0

  ; 사용자 데이터 및 설정 폴더 완전 삭제
  RMDir /r "$APPDATA\onoff-monitor"
  RMDir /r "$LOCALAPPDATA\onoff-monitor"
  RMDir /r "$LOCALAPPDATA\onoff-monitor-updater"
  
  ; 레지스트리 정보 완전 삭제
  DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey HKCU "Software\com.fitsociety.onoff"
  DeleteRegKey HKLM "Software\com.fitsociety.onoff"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Run\onoff-monitor"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Run\onoff-monitor"
!macroend
