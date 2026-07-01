const { exec } = require('child_process');

const command = `wevtutil qe System /q:"*[System[TimeCreated[timediff(@SystemTime) <= 172800000] and ((EventID=1 and Provider[@Name='Microsoft-Windows-Power-Troubleshooter']) or EventID=12 or EventID=6005 or EventID=6009 or EventID=7001 or EventID=7002 or EventID=1074 or EventID=6006 or EventID=6008 or EventID=42)]]" /f:xml`;

exec(command, { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 5 }, (err, stdout, stderr) => {
    if (err) {
        console.error("Error:", err);
        return;
    }
    
    const eventBlocks = stdout.split('</Event>');
    const events = [];
    for (const block of eventBlocks) {
        const idMatch = block.match(/<EventID(?:[^>]*)>(\d+)<\/EventID>/);
        const timeMatch = block.match(/<TimeCreated SystemTime='([^']+)'/);
        if (idMatch && timeMatch) {
            const id = parseInt(idMatch[1], 10);
            const dateObj = new Date(timeMatch[1]);
            const kstDate = new Date(dateObj.getTime() + (9 * 60 * 60 * 1000));
            const pad = (n) => n.toString().padStart(2, '0');
            const timeStr = `${kstDate.getUTCFullYear()}-${pad(kstDate.getUTCMonth()+1)}-${pad(kstDate.getUTCDate())} ${pad(kstDate.getUTCHours())}:${pad(kstDate.getUTCMinutes())}:${pad(kstDate.getUTCSeconds())}`;
            events.push({ Id: id, Time: timeStr });
        }
    }
    console.log(events);
});
