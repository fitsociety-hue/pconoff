function doPost(e) {
  // 에디터에서 직접 실행할 경우 e가 undefined이므로 예외 처리
  if (!e) return ContentService.createTextOutput("이 스크립트는 웹 앱으로 배포되어 호출되어야 합니다. 에디터에서 직접 실행할 수 없습니다.");
  var action = e.parameter.action;
  if (action == "uploadSeal") {
    return uploadSeal(e);
  } else if (action == "recordOff") {
    return recordOffTime(e);
  }
  return ContentService.createTextOutput("POST is only used for specific actions.");
}

function doGet(e) {
  // 에디터에서 직접 실행할 경우 e가 undefined이므로 예외 처리
  if (!e) return ContentService.createTextOutput("이 스크립트는 웹 앱으로 배포되어 호출되어야 합니다. 에디터에서 직접 실행할 수 없습니다.");
  var action = e.parameter.action;
  
  if (!action) {
    return ContentService.createTextOutput("ON/OFF Monitoring API is active.");
  }
  
  if (action == "register") {
    return registerUser(e);
  } else if (action == "login") {
    return loginUser(e);
  } else if (action == "adminLogin") {
    return adminLogin(e);
  } else if (action == "changeAdminPassword") {
    return changeAdminPassword(e);
  } else if (action == "recordBoot") {
    return recordBootTime(e);
  } else if (action == "recordOff") {
    return recordOffTime(e);
  } else if (action == "getStats") {
    return getStats(e);
  } else if (action == "getSeal") {
    return getSeal(e);
  } else if (action == "getUsers") {
    return getUsers(e);
  } else if (action == "updateUserStatus") {
    return updateUserStatus(e);
  } else if (action == "resetUserPassword") {
    return resetUserPassword(e);
  }
  
  return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": "Unknown action"})).setMimeType(ContentService.MimeType.JSON);
}

var cachedDoc = null;

function getSheet(sheetName) {
  if (!cachedDoc) {
    cachedDoc = SpreadsheetApp.getActiveSpreadsheet();
  }
  var sheet = cachedDoc.getSheetByName(sheetName);
  if (!sheet) {
    sheet = cachedDoc.insertSheet(sheetName);
    if (sheetName === "Users") {
      sheet.appendRow(["Team", "Name", "Role", "Password", "IsAdmin", "Status"]);
      // 기본 관리자 추가 (비밀번호: 2026의 SHA-256 해시값 필요)
      // 프론트에서 '2026'을 해시해서 보내도록 해야함
    } else if (sheetName === "Logs") {
      sheet.appendRow(["Date", "Name", "BootTime", "OffTime", "OvertimeApplied", "LastSeen"]);
    } else if (sheetName === "AdminSettings") {
      sheet.appendRow(["AdminId", "PasswordHash"]);
      // 2026의 SHA-256 해시는 프론트에서 생성하는 값과 매칭해야 하므로, 초기엔 프론트에서 가입 시키거나 해시값을 넣어야함.
      // 편의상 프론트엔드에서 admin 가입을 막고, 서버에서 검증 시 '2026' 해시값을 초기값으로 둡니다.
      // 2026의 SHA256: 158a323a7ba44870f23d96f1516dd70aa48e9a72db4ebb026b0a89e212a208ab
      sheet.appendRow(["admin", "158a323a7ba44870f23d96f1516dd70aa48e9a72db4ebb026b0a89e212a208ab"]);
    }
  }
  return sheet;
}

function initSheets() {
  getSheet("Users");
  getSheet("Logs");
  getSheet("AdminSettings");
}

function registerUser(e) {
  var team = String(e.parameter.team).trim();
  var name = String(e.parameter.name).trim();
  var role = String(e.parameter.role).trim();
  var passwordHash = e.parameter.password; // 프론트에서 해시된 문자열
  
  var sheet = getSheet("Users");
  var data = sheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === name) {
      return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": "이미 존재하는 이름입니다."})).setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  sheet.appendRow([team, name, role, passwordHash, "FALSE", "재직"]);
  return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": "회원가입 완료"})).setMimeType(ContentService.MimeType.JSON);
}

function loginUser(e) {
  var name = String(e.parameter.name || "").trim();
  var passwordHash = e.parameter.password;
  
  var sheet = getSheet("Users");
  var data = sheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === name && data[i][3] === passwordHash) {
      // 상태가 퇴사인지 확인
      if (data[i][5] === "퇴사") {
         return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": "퇴사 처리된 계정입니다."})).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "user": {"team": data[i][0], "name": String(data[i][1]).trim(), "role": data[i][2]}})).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": "이름 또는 비밀번호가 일치하지 않습니다."})).setMimeType(ContentService.MimeType.JSON);
}

function adminLogin(e) {
  var adminId = String(e.parameter.adminId || "").trim();
  var passwordHash = e.parameter.password;
  
  var sheet = getSheet("AdminSettings");
  var data = sheet.getDataRange().getValues();
  
  var storedHash = data.length > 1 ? String(data[1][1]).trim() : "";
  
  // 기존 초기 비밀번호(1107)에서 2026으로 변경 자동 적용 (구버전 해시값 자동 마이그레이션)
  var oldHash1 = "e111a8818c6426372ce661a34bd3c60fcbb6eb6f157fdf3173323cdd224a1803";
  var oldHash2 = "86cb35a822329fe1de40eb82a1791be1f66f8bd327446686bdd859a89e436853";
  var newHash2026 = "158a323a7ba44870f23d96f1516dd70aa48e9a72db4ebb026b0a89e212a208ab";
  
  if ((storedHash === oldHash1 || storedHash === oldHash2) && passwordHash === newHash2026) {
    sheet.getRange(2, 2).setValue(newHash2026);
    storedHash = newHash2026;
  }
  
  if (data.length > 1 && data[1][0] == adminId && storedHash == passwordHash) {
    return ContentService.createTextOutput(JSON.stringify({"status": "success"})).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": "관리자 정보가 일치하지 않습니다."})).setMimeType(ContentService.MimeType.JSON);
}

function changeAdminPassword(e) {
  var adminId = e.parameter.adminId;
  var oldPassword = e.parameter.oldPassword;
  var newPassword = e.parameter.newPassword;
  
  var sheet = getSheet("AdminSettings");
  var data = sheet.getDataRange().getValues();
  
  if (data.length > 1 && data[1][0] == adminId && data[1][1] == oldPassword) {
    sheet.getRange(2, 2).setValue(newPassword);
    return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": "비밀번호가 변경되었습니다."})).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": "기존 비밀번호가 일치하지 않습니다."})).setMimeType(ContentService.MimeType.JSON);
}

function getTodayString() {
  var tz = Session.getScriptTimeZone();
  return Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
}

function recordBootTime(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000); // Wait up to 10 seconds
  try {
    var name = e.parameter.name;
    var bootTime = e.parameter.bootTime; // 클라이언트에서 보낸 타임스탬프 또는 부팅시간 문자열
    var logDate = e.parameter.logDate;
    var dateStr = logDate ? logDate : getTodayString();
    
    var sheet = getSheet("Logs");
    var data = sheet.getDataRange().getValues();
    
    // 이미 오늘자 기록이 있는지 확인
    for (var i = 1; i < data.length; i++) {
      var rowDateStr = data[i][0] instanceof Date ? Utilities.formatDate(data[i][0], Session.getScriptTimeZone(), "yyyy-MM-dd") : String(data[i][0]).substring(0, 10);
      if (rowDateStr == dateStr && data[i][1] == name) {
        if (e.parameter.isDesktop === 'true') {
          // 데스크탑 앱에서 전송된 시스템 부팅 시간인 경우 덮어씌움
          var bootCell = sheet.getRange(i + 1, 3);
          bootCell.setNumberFormat('@');
          bootCell.setValue(bootTime);
          
          // 부팅 시 과거 날짜의 빈 OffTime을 LastSeen으로 보정
          _fillMissingOffTimeFromLastSeen(sheet, data, name, dateStr);
          
          return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": "데스크탑 부팅 시간으로 업데이트 완료"})).setMimeType(ContentService.MimeType.JSON);
        }
        // 이미 부팅 기록이 있다면 업데이트하지 않고 기존 유지
        return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": "이미 오늘 부팅 기록이 존재합니다."})).setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    sheet.appendRow([dateStr, name, bootTime, "", "No", ""]);
    var newRow = sheet.getLastRow();
    sheet.getRange(newRow, 3).setNumberFormat('@');
    sheet.getRange(newRow, 4).setNumberFormat('@');
    
    // 부팅 시 과거 날짜의 빈 OffTime을 LastSeen으로 보정
    if (e.parameter.isDesktop === 'true') {
      var freshData = sheet.getDataRange().getValues();
      _fillMissingOffTimeFromLastSeen(sheet, freshData, name, dateStr);
    }
    
    return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": "부팅 시간 기록 완료"})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// 과거 날짜에 OffTime이 비어있지만 LastSeen이 있는 경우, LastSeen을 OffTime으로 복사
// (PC 종료 시 실시간 전송이 실패했을 때의 백업 보정 로직)
function _fillMissingOffTimeFromLastSeen(sheet, data, name, todayStr) {
  var tz = Session.getScriptTimeZone();
  for (var j = 1; j < data.length; j++) {
    if (String(data[j][1]).trim() != name) continue;
    
    var rowDate = data[j][0] instanceof Date ? Utilities.formatDate(data[j][0], tz, "yyyy-MM-dd") : String(data[j][0]).substring(0, 10);
    if (rowDate == todayStr) continue; // 오늘 날짜는 건너뜀
    
    var rowOffTime = String(data[j][3]).trim();
    var rowLastSeen = data[j].length > 5 ? String(data[j][5]).trim() : '';
    
    var offTimeEmpty = (!rowOffTime || rowOffTime === '' || rowOffTime === '-');
    var lastSeenExists = (rowLastSeen && rowLastSeen !== '' && rowLastSeen !== '-');
    
    if (offTimeEmpty && lastSeenExists) {
      var offCell = sheet.getRange(j + 1, 4);
      offCell.setNumberFormat('@');
      offCell.setValue(data[j][5]); // 원본 값 사용
    }
  }
}

function recordOffTime(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000); // Wait up to 10 seconds for other processes to finish
  try {
    var name = e.parameter.name;
    var offTime = e.parameter.offTime;
    var logDate = e.parameter.logDate;
    var isHeartbeat = e.parameter.isHeartbeat === 'true';
    var isDesktop = e.parameter.isDesktop === 'true';
    var dateStr = logDate ? logDate : getTodayString();
    
    // Heartbeat 요청은 반드시 데스크탑 앱(isDesktop=true)에서만 허용
    if (isHeartbeat && !isDesktop) {
      return ContentService.createTextOutput(JSON.stringify({"status": "ignored", "message": "Heartbeat는 데스크탑 앱에서만 허용됩니다."})).setMimeType(ContentService.MimeType.JSON);
    }
    
    var sheet = getSheet("Logs");
    var data = sheet.getDataRange().getValues();
    
    for (var i = data.length - 1; i >= 1; i--) {
      var rowDateStr = data[i][0] instanceof Date ? Utilities.formatDate(data[i][0], Session.getScriptTimeZone(), "yyyy-MM-dd") : String(data[i][0]).substring(0, 10);
      if (rowDateStr == dateStr && data[i][1] == name) {
        
        // ===== Heartbeat: LastSeen 컬럼(6번째)에만 기록, OffTime은 절대 건드리지 않음 =====
        if (isHeartbeat) {
          var lastSeenCell = sheet.getRange(i + 1, 6);
          lastSeenCell.setNumberFormat('@');
          lastSeenCell.setValue(offTime);
          return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": "LastSeen 기록 완료"})).setMimeType(ContentService.MimeType.JSON);
        }
        
        // ===== 실제 종료 이벤트: OffTime 컬럼(4번째)에 기록 =====
        var existingOffTimeValue = sheet.getRange(i + 1, 4).getValue();
        var existingOffTime = "";
        if (existingOffTimeValue instanceof Date) {
          existingOffTime = Utilities.formatDate(existingOffTimeValue, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
        } else {
          existingOffTime = String(existingOffTimeValue);
        }
        
        var shouldUpdate = false;
        if (existingOffTime == "" || existingOffTime == "-") {
          shouldUpdate = true;
        } else {
          var newDate = new Date(String(offTime).replace(' ', 'T'));
          var oldDate = new Date(existingOffTime.replace(' ', 'T'));
          
          if (!isNaN(newDate.getTime())) {
            if (!isNaN(oldDate.getTime())) {
              if (newDate >= oldDate) shouldUpdate = true;
            } else {
              shouldUpdate = true;
            }
          } else {
            if (String(offTime) > existingOffTime) shouldUpdate = true;
          }
        }
        
        if (shouldUpdate) {
          var offCell = sheet.getRange(i + 1, 4);
          offCell.setNumberFormat('@');
          offCell.setValue(offTime);
        }
        return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": "종료 시간 기록 완료"})).setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // 오늘자 부팅 기록이 없을 경우
    if (isHeartbeat) {
      // Heartbeat: LastSeen만 기록, OffTime은 비워둠
      sheet.appendRow([dateStr, name, "-", "", "No", offTime]);
      var newRow = sheet.getLastRow();
      sheet.getRange(newRow, 3).setNumberFormat('@');
      sheet.getRange(newRow, 4).setNumberFormat('@');
      sheet.getRange(newRow, 6).setNumberFormat('@');
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": "LastSeen 기록 완료 (새 행)"})).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 실제 종료 이벤트: OffTime에 기록
    sheet.appendRow([dateStr, name, "-", offTime, "No", ""]);
    var newRow = sheet.getLastRow();
    sheet.getRange(newRow, 3).setNumberFormat('@');
    sheet.getRange(newRow, 4).setNumberFormat('@');
    return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": "부팅 기록 없이 종료 시간 기록 완료"})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
function getStats(e) {
  var logSheet = getSheet("Logs");
  var logData = logSheet.getDataRange().getValues();
  var logs = [];
  var tz = Session.getScriptTimeZone();
  var todayStr = getTodayString();
  
  for (var i = 1; i < logData.length; i++) {
    // 날짜 포맷팅: Date 객체인 경우 명시적으로 yyyy-MM-dd 형식으로 변환
    var dateVal = logData[i][0];
    if (dateVal instanceof Date) {
      dateVal = Utilities.formatDate(dateVal, tz, "yyyy-MM-dd");
    }
    
    // bootTime 포맷팅: Date 객체인 경우 초 단위까지 포함하여 문자열로 변환
    var bootTimeVal = logData[i][2];
    if (bootTimeVal instanceof Date) {
      bootTimeVal = Utilities.formatDate(bootTimeVal, tz, "yyyy-MM-dd HH:mm:ss");
    }
    
    // offTime 포맷팅: Date 객체인 경우 초 단위까지 포함하여 문자열로 변환
    var offTimeVal = logData[i][3];
    if (offTimeVal instanceof Date) {
      offTimeVal = Utilities.formatDate(offTimeVal, tz, "yyyy-MM-dd HH:mm:ss");
    }
    
    // LastSeen 컬럼 (6번째, index 5) 읽기
    var lastSeenVal = logData[i].length > 5 ? logData[i][5] : '';
    if (lastSeenVal instanceof Date) {
      lastSeenVal = Utilities.formatDate(lastSeenVal, tz, "yyyy-MM-dd HH:mm:ss");
    }
    
    // 과거 날짜에 OffTime이 비어있지만 LastSeen이 있으면, LastSeen을 OffTime 대신 표시
    // (PC 종료 시 실시간 전송이 실패하고, 아직 다음 부팅도 안 한 경우의 백업)
    var offTimeEmpty = (!offTimeVal || String(offTimeVal).trim() === '' || String(offTimeVal).trim() === '-');
    var lastSeenExists = (lastSeenVal && String(lastSeenVal).trim() !== '' && String(lastSeenVal).trim() !== '-');
    if (offTimeEmpty && lastSeenExists && String(dateVal) !== todayStr) {
      offTimeVal = lastSeenVal;
    }
    
    logs.push({
      "date": dateVal,
      "name": logData[i][1],
      "bootTime": bootTimeVal,
      "offTime": offTimeVal,
      "overtime": logData[i][4]
    });
  }
  
  return ContentService.createTextOutput(JSON.stringify({"status": "success", "data": logs})).setMimeType(ContentService.MimeType.JSON);
}

function uploadSeal(e) {
  var sealData = e.parameter.sealData;
  var sheet = getSheet("AdminSettings");
  var data = sheet.getDataRange().getValues();
  
  if (data.length > 1) {
    sheet.getRange(2, 3).setValue(sealData);
  }
  return ContentService.createTextOutput(JSON.stringify({"status": "success"})).setMimeType(ContentService.MimeType.JSON);
}

function getSeal(e) {
  var sheet = getSheet("AdminSettings");
  var data = sheet.getDataRange().getValues();
  
  var sealData = "";
  if (data.length > 1 && data[1].length >= 3) {
    sealData = data[1][2];
  }
  return ContentService.createTextOutput(JSON.stringify({"status": "success", "sealData": sealData})).setMimeType(ContentService.MimeType.JSON);
}

function getUsers(e) {
  var sheet = getSheet("Users");
  var data = sheet.getDataRange().getValues();
  var users = [];
  
  for (var i = 1; i < data.length; i++) {
    // If status is empty, default to "재직" (Active)
    var status = data[i][5] ? data[i][5] : "재직";
    users.push({
      "team": data[i][0],
      "name": data[i][1],
      "role": data[i][2],
      "status": status
    });
  }
  
  return ContentService.createTextOutput(JSON.stringify({"status": "success", "data": users})).setMimeType(ContentService.MimeType.JSON);
}

function updateUserStatus(e) {
  var name = e.parameter.name;
  var status = e.parameter.status;
  
  var sheet = getSheet("Users");
  var data = sheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] == name) {
      sheet.getRange(i + 1, 6).setValue(status);
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": "상태가 변경되었습니다."})).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": "사용자를 찾을 수 없습니다."})).setMimeType(ContentService.MimeType.JSON);
}

function resetUserPassword(e) {
  var name = e.parameter.name;
  var newPasswordHash = e.parameter.newPasswordHash;
  
  var sheet = getSheet("Users");
  var data = sheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] == name) {
      sheet.getRange(i + 1, 4).setValue(newPasswordHash);
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": "비밀번호가 재설정되었습니다."})).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": "사용자를 찾을 수 없습니다."})).setMimeType(ContentService.MimeType.JSON);
}