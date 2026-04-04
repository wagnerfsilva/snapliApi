#!/usr/bin/env node
/**
 * Testa envio de email via AWS SES
 * Uso: node scripts/test/test-ses-email.js
 */
require('dotenv').config();
process.env.NODE_ENV = 'production';
process.env.EMAIL_PROVIDER = 'ses';

// Recarrega o serviço com as flags corretas
delete require.cache[require.resolve('../../src/services/email.service')];
const emailService = require('../../src/services/email.service');

const fakeOrder = {
    id: '25cf16c7-266c-4bd9-b440-28a170f45366',
    customerName: 'Teste SES Snapli',
    customerEmail: process.env.SMTP_USER,
    downloadToken: 'test-token-ses-' + Date.now(),
    downloadExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    totalAmount: '150.00',
    items: [{ id: 1 }, { id: 2 }, { id: 3 }]
};

console.log('Enviando email de teste via AWS SES...');
console.log('Para:', fakeOrder.customerEmail);

emailService.sendDownloadEmail(fakeOrder)
    .then(() => {
        console.log('✅ Email enviado com sucesso via AWS SES!');
        process.exit(0);
    })
    .catch(e => {
        console.error('❌ Erro:', e.message);
        if (e.Code) console.error('   Código:', e.Code);
        process.exit(1);
    });
