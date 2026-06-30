const { exec } = require('child_process');
const psCommand = "$days = (Get-Date).AddDays(-3).Date; $events = Get-WinEvent -FilterHashtable @{LogName='System'; Id=1,12,6005,6009,7001,7002,1074,6006,6008,42; StartTime=$days} -ErrorAction SilentlyContinue | Select-Object TimeCreated, Id; if ($events) { $events | ConvertTo-Json -Compress } else { '[]' }";
exec(`powershell -Command "${psCommand}"`, { encoding: 'utf-8', maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
        console.error("Failed to execute PowerShell command", error);
        return;
    }
    
    console.log("Output:", stdout.trim());
});
