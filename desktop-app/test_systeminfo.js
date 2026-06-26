const { execSync } = require('child_process');
try {
    const output = execSync('chcp 65001 && systeminfo /fo csv', { encoding: 'utf-8' });
    const lines = output.trim().split('\n');
    const headerLine = lines.find(l => l.includes('OS Name'));
    const dataLine = lines[lines.indexOf(headerLine) + 1];
    
    const headers = headerLine.split('","').map(s => s.replace(/"/g, ''));
    const data = dataLine.split('","').map(s => s.replace(/"/g, ''));
    
    const bootTimeIndex = headers.findIndex(h => h.includes('System Boot Time') || h.includes('부팅 시간'));
    console.log("Boot time:", data[bootTimeIndex]);
} catch (e) {
    console.error(e.toString());
}
