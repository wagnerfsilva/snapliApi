#!/usr/bin/env node
/**
 * Setup AWS SES para o domínio snapli.com.br
 * 
 * Pré-requisito: rodar com credenciais de ADMIN AWS
 * Uso: AWS_ACCESS_KEY_ID=xxx AWS_SECRET_ACCESS_KEY=xxx node scripts/setup/setup-ses.js
 */
require('dotenv').config();

const { SESClient, VerifyDomainIdentityCommand, VerifyEmailIdentityCommand, GetIdentityVerificationAttributesCommand } = require('@aws-sdk/client-ses');

const DOMAIN = 'snapli.com.br';
const EMAIL = 'noreply@snapli.com.br';
const REGION = process.env.AWS_REGION || 'us-east-1';

const ses = new SESClient({
    region: REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

async function setup() {
    console.log(`\n🔧 Configurando AWS SES na região ${REGION}\n`);

    // 1. Verificar domínio
    console.log(`📧 Solicitando verificação do domínio: ${DOMAIN}`);
    try {
        const domainRes = await ses.send(new VerifyDomainIdentityCommand({ Domain: DOMAIN }));
        console.log(`✅ Token de verificação DKIM: ${domainRes.VerificationToken}`);
        console.log(`\n⚠️  Adicione este registro TXT no DNS do domínio ${DOMAIN}:`);
        console.log(`   Nome: _amazonses.${DOMAIN}`);
        console.log(`   Valor: ${domainRes.VerificationToken}`);
    } catch (e) {
        if (e.name === 'AccessDenied' || e.Code === 'AccessDenied') {
            console.error(`❌ Permissão negada. Verifique as credenciais AWS (precisa de acesso admin).`);
            console.error(`   Erro: ${e.message}`);
        } else {
            console.error(`❌ Erro no domínio: ${e.message}`);
        }
    }

    // 2. Verificar email
    console.log(`\n📧 Solicitando verificação do email: ${EMAIL}`);
    try {
        await ses.send(new VerifyEmailIdentityCommand({ EmailAddress: EMAIL }));
        console.log(`✅ Email de verificação enviado para ${EMAIL}`);
        console.log(`   Acesse a caixa de entrada e clique no link de verificação.`);
    } catch (e) {
        if (e.name === 'AccessDenied' || e.Code === 'AccessDenied') {
            console.error(`❌ Permissão negada: ${e.message}`);
        } else {
            console.error(`❌ Erro no email: ${e.message}`);
        }
    }

    // 3. Checar status
    console.log(`\n📊 Status de verificação atual:`);
    try {
        const status = await ses.send(new GetIdentityVerificationAttributesCommand({
            Identities: [DOMAIN, EMAIL]
        }));
        const attrs = status.VerificationAttributes || {};
        for (const [id, attr] of Object.entries(attrs)) {
            console.log(`   ${id}: ${attr.VerificationStatus}`);
        }
    } catch (e) {
        console.log(`   (sem permissão para listar - erro: ${e.message})`);
    }

    console.log(`\n📋 Próximos passos:`);
    console.log(`   1. Verifique o email noreply@snapli.com.br (link na caixa de entrada)`);
    console.log(`   2. Adicione o registro TXT _amazonses no DNS da Hostinger`);
    console.log(`   3. Adicione permissão SES ao IAM user 'fotow-app-user':`);
    console.log(`      ses:SendEmail, ses:SendRawEmail`);
    console.log(`   4. No Railway, defina: EMAIL_PROVIDER=ses`);
    console.log(`   5. Teste: node scripts/test/test-ses-email.js\n`);
}

setup().catch(console.error);
