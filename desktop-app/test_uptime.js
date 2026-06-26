const os = require('os');
const bootTimeMs = Date.now() - os.uptime() * 1000;
const bootTimeStr = new Date(bootTimeMs).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
console.log("os.uptime boot time:", bootTimeStr);
