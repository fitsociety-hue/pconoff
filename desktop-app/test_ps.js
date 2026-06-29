const { execSync } = require('child_process');

let psCommand = `$today = (Get-Date).Date; $events = Get-WinEvent -FilterHashtable @{LogName='System'; Id=1,12,6005,6009,7001; StartTime=$today} -ErrorAction SilentlyContinue; if ($events) { $events | Sort-Object TimeCreated | Select-Object -First 1 -ExpandProperty TimeCreated | Get-Date -Format 'yyyy-MM-dd HH:mm:ss' } else { Get-Date -Format 'yyyy-MM-dd HH:mm:ss' }`;

try {
    const output = execSync(`powershell -Command "${psCommand}"`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    console.log("Output:", output);
} catch (e) {
}
