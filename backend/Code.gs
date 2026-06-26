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
  }
  
  return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": "Unknown action"})).setMimeType(ContentService.MimeType.JSON);
}

function getSheet(sheetName) {
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = doc.getSheetByName(sheetName);
  if (!sheet) {
    sheet = doc.insertSheet(sheetName);
    if (sheetName === "Users") {
      sheet.appendRow(["Team", "Name", "Role", "Password", "IsAdmin"]);
      // 기본 관리자 추가 (비밀번호: 2026의 SHA-256 해시값 필요)
      // 프론트에서 '2026'을 해시해서 보내도록 해야함
    } else if (sheetName === "Logs") {
      sheet.appendRow(["Date", "Name", "BootTime", "OffTime", "OvertimeApplied"]);
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
  var team = e.parameter.team;
  var name = e.parameter.name;
  var role = e.parameter.role;
  var passwordHash = e.parameter.password; // 프론트에서 해시된 문자열
  
  var sheet = getSheet("Users");
  var data = sheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] == name) {
      return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": "이미 존재하는 이름입니다."})).setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  sheet.appendRow([team, name, role, passwordHash, "FALSE"]);
  return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": "회원가입 완료"})).setMimeType(ContentService.MimeType.JSON);
}

function loginUser(e) {
  var name = e.parameter.name;
  var passwordHash = e.parameter.password;
  
  var sheet = getSheet("Users");
  var data = sheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] == name && data[i][3] == passwordHash) {
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "user": {"team": data[i][0], "name": data[i][1], "role": data[i][2]}})).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": "이름 또는 비밀번호가 일치하지 않습니다."})).setMimeType(ContentService.MimeType.JSON);
}

function adminLogin(e) {
  var adminId = e.parameter.adminId;
  var passwordHash = e.parameter.password;
  
  var sheet = getSheet("AdminSettings");
  var data = sheet.getDataRange().getValues();
  
  var storedHash = data[1][1];
  
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
  var name = e.parameter.name;
  var bootTime = e.parameter.bootTime; // 클라이언트에서 보낸 타임스탬프 또는 부팅시간 문자열
  var dateStr = getTodayString();
  
  var sheet = getSheet("Logs");
  var data = sheet.getDataRange().getValues();
  
  // 이미 오늘자 기록이 있는지 확인
  for (var i = 1; i < data.length; i++) {
    var rowDateStr = data[i][0] instanceof Date ? Utilities.formatDate(data[i][0], Session.getScriptTimeZone(), "yyyy-MM-dd") : String(data[i][0]).substring(0, 10);
    if (rowDateStr == dateStr && data[i][1] == name) {
      // 이미 부팅 기록이 있다면 업데이트하지 않고 기존 유지
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": "이미 오늘 부팅 기록이 존재합니다."})).setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  sheet.appendRow([dateStr, name, bootTime, "", "No"]);
  return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": "부팅 시간 기록 완료"})).setMimeType(ContentService.MimeType.JSON);
}

function recordOffTime(e) {
  var name = e.parameter.name;
  var offTime = e.parameter.offTime;
  var dateStr = getTodayString();
  
  var sheet = getSheet("Logs");
  var data = sheet.getDataRange().getValues();
  
  for (var i = data.length - 1; i >= 1; i--) {
    var rowDateStr = data[i][0] instanceof Date ? Utilities.formatDate(data[i][0], Session.getScriptTimeZone(), "yyyy-MM-dd") : String(data[i][0]).substring(0, 10);
    if (rowDateStr == dateStr && data[i][1] == name) {
      sheet.getRange(i + 1, 4).setValue(offTime);
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": "종료 시간 기록 완료"})).setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": "오늘자 부팅 기록을 찾을 수 없습니다."})).setMimeType(ContentService.MimeType.JSON);
}
function getStats(e) {
  var logSheet = getSheet("Logs");
  var logData = logSheet.getDataRange().getValues();
  var logs = [];
  
  for (var i = 1; i < logData.length; i++) {
    logs.push({
      "date": logData[i][0],
      "name": logData[i][1],
      "bootTime": logData[i][2],
      "offTime": logData[i][3],
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
