const { exec } = require('child_process');
const psCommand = `
    $days = (Get-Date).AddDays(-3).Date;
    $events = Get-WinEvent -FilterHashtable @{LogName='System'; Id=1,12,6005,6009,7001,7002,1074,6006,6008,42; StartTime=$days} -ErrorAction SilentlyContinue | Select-Object TimeCreated, Id;
    if ($events) { $events | ConvertTo-Json -Compress } else { "[]" }
`;
exec(`powershell -Command "${psCommand}"`, { encoding: 'utf-8', maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
        console.error("Failed to execute PowerShell command", error);
        return;
    }
    
    const output = stdout.trim();
    try {
        const rawEvents = JSON.parse(output);
        const events = (Array.isArray(rawEvents) ? rawEvents : [rawEvents]).map(e => {
            let ts = 0;
            if (e.TimeCreated) {
                const match = e.TimeCreated.match(/\/Date\((\d+)\)\//);
                if (match) {
                    ts = parseInt(match[1], 10);
                } else {
                    ts = new Date(e.TimeCreated).getTime();
                }
            }
            if (isNaN(ts)) ts = 0;
            return { time: ts, id: e.Id };
        }).filter(e => e.time > 0);
        console.log("Found", events.length, "events");
        console.log("Latest:", events[events.length - 1]);
    } catch(e) {
        console.error(e);
    }
});
