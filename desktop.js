// PİNTİ'nin tek dosyalık Windows sürümü için başlangıç noktası.
// Normal "npm start" akışı server.js üzerinden aynen çalışmaya devam eder.
process.env.PORT = process.env.PORT || '3001';

require('./server');

if (process.pkg && process.env.PINTI_NO_BROWSER !== 'true') {
    const { execFile } = require('child_process');
    setTimeout(() => {
        execFile('cmd.exe', ['/c', 'start', '', `http://localhost:${process.env.PORT}`], () => {});
    }, 1100);
}
