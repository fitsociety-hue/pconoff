const { execSync } = require('child_process');
const psCommand = `
$days = (Get-Date).AddDays(-3).Date;
$events = Get-WinEvent -FilterHashtable @{LogName='System'; Id=1,12,6005,6009,7001,7002,1074,6006,6008,42; StartTime=$days} -ErrorAction SilentlyContinue;
if ($events) {
    $events | ForEach-Object { "$($_.Id),$($_.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss'))" }
}
`;
try {
    const output = execSync(`powershell -Command "${psCommand.replace(/\n/g, ' ')}"`, { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
    console.log(output.trim());
} catch(e) {
    console.error(e);
}
