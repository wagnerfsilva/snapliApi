const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');

const API_URL = 'https://snapliapi-production.up.railway.app/api';
const EVENT_ID = 'ab00f274-ea68-4749-9a7f-3cf0aef3d5b8';
const FOLDER = '/Volumes/Externo/Charles/Charles';
const LOGIN = 'fotografo@gmail.com';
const SENHA = '%65434343';

const FAILED_FILES = [
  'Chacha-3208.jpg','Chacha-3209.jpg','Chacha-321.jpg','Chacha-3210.jpg','Chacha-3211.jpg',
  'Chacha-3212.jpg','Chacha-3213.jpg','Chacha-3214.jpg','Chacha-3215.jpg','Chacha-3216.jpg',
  'Chacha-324.jpg','Chacha-3240.jpg','Chacha-3241.jpg','Chacha-3242.jpg','Chacha-3243.jpg',
  'Chacha-3456.jpg','Chacha-3457.jpg','Chacha-3458.jpg','Chacha-3459.jpg','Chacha-346.jpg'
];

async function run() {
  const res = await fetch(API_URL + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: LOGIN, password: SENHA })
  });
  const data = await res.json();
  const token = data.data.token;
  console.log('✅ Autenticado\n');

  let ok = 0, fail = 0;
  for (const file of FAILED_FILES) {
    const filePath = path.join(FOLDER, file);
    if (!fs.existsSync(filePath)) {
      console.log('❌ Não encontrado:', file);
      fail++;
      continue;
    }
    const form = new FormData();
    form.append('photos', fs.createReadStream(filePath), file);
    form.append('eventId', EVENT_ID);
    try {
      const r = await fetch(API_URL + '/photos/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, ...form.getHeaders() },
        body: form
      });
      const d = await r.json();
      if (r.ok) { console.log('✅', file); ok++; }
      else { console.log('❌', file, '-', d.message); fail++; }
    } catch (e) {
      console.log('❌', file, '-', e.message);
      fail++;
    }
  }
  console.log(`\nResultado: ${ok} ok | ${fail} falhas`);
}

run().catch(console.error);
