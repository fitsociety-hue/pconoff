const { execSync } = require('child_process');
const psCommand = `$days = (Get-Date).AddDays(-3).Date; $events = Get-WinEvent -FilterHashtable @{LogName='System'; Id=1,12,6005,6009,7001,7002,1074,6006,6008,42; StartTime=$days} -ErrorAction SilentlyContinue; if ($events) { $events | ForEach-Object { '{0},{1},{2}' -f $_.Id, $_.ProviderName, $_.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss') } }`;
try {
    const output = execSync(`powershell -Command "${psCommand}"`, { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
    const lines = output.trim().split('\n').map(l => l.trim()).filter(l => l.includes('2026-06-30 18:'));
    console.log(lines.join('\n'));
} catch(e) {
    console.error(e);
}
