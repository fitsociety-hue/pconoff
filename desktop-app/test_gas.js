const { execSync } = require('child_process');
console.log(execSync('curl.exe -s -L "https://script.google.com/macros/s/AKfycbxOHHpWE5IX1pikWQHni8VVW6D3NZdgHZDg7Z2sW9zRRlHV3pJUjvmPuLh_5Alq7mpx/exec?action=recordOff&name=' + encodeURIComponent('김용필') + '&offTime=2026-06-25%2022:22:22&logDate=2026-06-25&isDesktop=true&t=1"').toString());
