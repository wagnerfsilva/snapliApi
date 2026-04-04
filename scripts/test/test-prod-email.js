const https = require('https');
const url = 'https://snapliapi-production.up.railway.app/api/downloads/test-email/25cf16c7-266c-4bd9-b440-28a170f45366';

console.log('Chamando:', url);
const req = https.get(url, { timeout: 30000 }, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        console.log('STATUS:', res.statusCode);
        console.log('BODY:', data);
        process.exit(0);
    });
});
req.on('timeout', () => { console.log('TIMEOUT'); req.destroy(); process.exit(1); });
req.on('error', (e) => { console.error('ERROR:', e.message); process.exit(1); });
