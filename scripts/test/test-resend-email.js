#!/usr/bin/env node
/**
 * Testa envio de email via Resend HTTP API
 * Uso: node scripts/test/test-resend-email.js
 */
require('dotenv').config();
process.env.NODE_ENV = 'production';
process.env.EMAIL_PROVIDER = 'resend';
// RESEND_API_KEY ou usa SMTP_PASS como fallback

// Recarrega o serviço com as flags corretas
delete require.cache[require.resolve('../../src/services/email.service')];
const emailService = require('../../src/services/email.service');

const fakeOrder = {
    id: '25cf16c7-266c-4bd9-b440-28a170f45366',
    customerName: 'Teste Resend Snapli',
    customerEmail: process.env.SMTP_USER || 'wagnerdesignweb@gmail.com',
    downloadToken: 'test-token-resend-' + Date.now(),
    downloadExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    totalAmount: '150.00',
    items: [{ id: 1 }, { id: 2 }, { id: 3 }]
};

console.log('Enviando email de teste via Resend HTTP API...');
console.log('Para:', fakeOrder.customerEmail);

emailService.sendDownloadEmail(fakeOrder)
    .then(() => {
        console.log('✅ Email enviado com sucesso via Resend HTTP API!');
        process.exit(0);
    })
    .catch(e => {
        console.error('❌ Erro:', e.message);
        process.exit(1);
    });
