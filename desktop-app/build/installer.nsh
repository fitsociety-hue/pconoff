!macro customInit
  ReadRegStr $R0 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ReadRegStr $R1 HKCU "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
  
  ${If} $R0 == ""
    ReadRegStr $R0 HKLM "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    ReadRegStr $R1 HKLM "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
  ${EndIf}
  
  ${If} $R0 != ""
    MessageBox MB_YESNOCANCEL|MB_ICONQUESTION "출퇴근기록앱이 이미 설치되어 있습니다. 원하시는 작업을 선택해주세요.$\n$\n[예] 기존 앱 및 데이터 완전 삭제 (제거 후 설치 프로그램 종료)$\n[아니오] 업데이트 / 덮어쓰기 설치 진행$\n[취소] 취소" IDYES do_uninstall IDCANCEL do_cancel
    
    Goto do_continue
    
    do_uninstall:
      ; Run uninstaller silently and wait for it
      ExecWait '$R0 /S _?=$R1'
      
      ; Force delete app data and remnants
      RMDir /r "$APPDATA\onoff-monitor"
      RMDir /r "$LOCALAPPDATA\onoff-monitor"
      RMDir /r "$LOCALAPPDATA\onoff-monitor-updater"
      
      MessageBox MB_OK|MB_ICONINFORMATION "완전 삭제가 완료되었습니다."
      Quit
      
    do_cancel:
      Quit
      
    do_continue:
  ${EndIf}
!macroend

!macro customUnInstall
  RMDir /r "$APPDATA\onoff-monitor"
  RMDir /r "$LOCALAPPDATA\onoff-monitor"
  RMDir /r "$LOCALAPPDATA\onoff-monitor-updater"
!macroend
