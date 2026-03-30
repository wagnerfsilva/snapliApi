#!/usr/bin/env node

/**
 * Snapli - Reprocessar Fotos com Erro de Reconhecimento Facial
 * 
 * Uso:
 *   node retry-failed.js [eventId]
 * 
 * Exemplos:
 *   node retry-failed.js
 *   node retry-failed.js 803bff31-1dab-4ef9-8223-5a0ade60ca32
 */

const fetch = require('node-fetch');

// ============================================================
// CONFIGURAÇÃO
// ============================================================
const CONFIG = {
    EVENT_ID: process.argv[2] || '803bff31-1dab-4ef9-8223-5a0ade60ca32',
    API_URL: process.env.API_URL || 'https://snapliapi-production.up.railway.app/api',
    LOGIN: process.env.LOGIN || 'fotografo@gmail.com',
    SENHA: process.env.SENHA || '%65434343',
    CONCURRENT_RETRIES: 3,          // Retries simultâneos
    DELAY_BETWEEN_BATCHES: 2000,    // 2s entre lotes
    MAX_RETRY_ATTEMPTS: 2,          // Tentativas por foto
    REQUEST_TIMEOUT: 60000,         // 60s por retry
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// AUTENTICAÇÃO
// ============================================================
async function authenticate() {
    console.log('🔐 Autenticando...');
    
    const response = await fetch(`${CONFIG.API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: CONFIG.LOGIN,
            password: CONFIG.SENHA,
        }),
    });

    const data = await response.json();
    
    if (!response.ok || !data.success) {
        throw new Error(`Falha na autenticação: ${data.message || response.statusText}`);
    }

    console.log(`✅ Autenticado como ${data.data.user.name || data.data.user.email}`);
    return data.data.token;
}

// ============================================================
// BUSCAR FOTOS COM ERRO
// ============================================================
async function fetchFailedPhotos(token) {
    console.log('\n📂 Buscando fotos com erro...');
    
    const allFailed = [];
    let page = 1;
    const limit = 100;
    
    while (true) {
        const url = `${CONFIG.API_URL}/photos/event/${CONFIG.EVENT_ID}?processingStatus=failed&page=${page}&limit=${limit}`;
        
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` },
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(`Erro ao buscar fotos: ${data.message || response.statusText}`);
        }

        const photos = data.data?.photos || data.data || [];
        
        if (photos.length === 0) break;
        
        allFailed.push(...photos);
        
        // Se retornou menos que o limit, não há mais páginas
        if (photos.length < limit) break;
        
        page++;
    }

    return allFailed;
}

// ============================================================
// RETRY DE UMA FOTO
// ============================================================
async function retryPhoto(photoId, token) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

    try {
        const response = await fetch(`${CONFIG.API_URL}/photos/${photoId}/retry`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            signal: controller.signal,
        });

        clearTimeout(timeout);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || `HTTP ${response.status}`);
        }

        return { success: true };
    } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
            return { success: false, error: 'Timeout' };
        }
        return { success: false, error: err.message };
    }
}

// ============================================================
// LOOP PRINCIPAL
// ============================================================
async function main() {
    const startTime = Date.now();

    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  SNAPLI - Reprocessar Fotos com Erro            ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
    console.log(`🎯 Evento: ${CONFIG.EVENT_ID}`);
    console.log(`🌐 API:    ${CONFIG.API_URL}`);
    console.log('');

    // 1. Autenticar
    const token = await authenticate();

    // 2. Buscar fotos com erro
    const failedPhotos = await fetchFailedPhotos(token);
    console.log(`   Encontradas: ${failedPhotos.length} fotos com erro`);

    if (failedPhotos.length === 0) {
        console.log('\n✅ Nenhuma foto com erro! Tudo certo.');
        return;
    }

    // Mostrar erros encontrados
    const errorCounts = {};
    for (const photo of failedPhotos) {
        const err = photo.processingError || 'Erro desconhecido';
        errorCounts[err] = (errorCounts[err] || 0) + 1;
    }
    console.log('\n📊 Tipos de erros encontrados:');
    for (const [err, count] of Object.entries(errorCounts)) {
        console.log(`   ${count}x — ${err}`);
    }

    // 3. Reprocessar em lotes
    console.log(`\n🔄 Reprocessando ${failedPhotos.length} fotos (${CONFIG.CONCURRENT_RETRIES} por vez)...`);
    console.log('─'.repeat(50));

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < failedPhotos.length; i += CONFIG.CONCURRENT_RETRIES) {
        const batch = failedPhotos.slice(i, i + CONFIG.CONCURRENT_RETRIES);
        const batchNum = Math.floor(i / CONFIG.CONCURRENT_RETRIES) + 1;
        const totalBatches = Math.ceil(failedPhotos.length / CONFIG.CONCURRENT_RETRIES);

        process.stdout.write(`  [${batchNum}/${totalBatches}] Reprocessando ${batch.length} fotos... `);

        const results = await Promise.all(
            batch.map(photo => retryPhoto(photo.id, token))
        );

        const batchSuccess = results.filter(r => r.success).length;
        const batchFail = results.filter(r => !r.success).length;
        
        successCount += batchSuccess;
        failCount += batchFail;

        const pct = Math.round(((i + batch.length) / failedPhotos.length) * 100);
        console.log(`✅ ${batchSuccess} ok, ❌ ${batchFail} erro (${pct}%)`);

        // Mostrar erros individuais
        results.forEach((r, idx) => {
            if (!r.success) {
                console.log(`     ⚠️  ${batch[idx].id}: ${r.error}`);
            }
        });

        // Delay entre lotes
        if (i + CONFIG.CONCURRENT_RETRIES < failedPhotos.length) {
            await sleep(CONFIG.DELAY_BETWEEN_BATCHES);
        }
    }

    // 4. Resumo
    const elapsed = Date.now() - startTime;
    const seconds = Math.floor(elapsed / 1000);

    console.log('\n');
    console.log('═'.repeat(50));
    console.log('         RESUMO DO REPROCESSAMENTO');
    console.log('═'.repeat(50));
    console.log(`  ✅ Reprocessamento iniciado: ${successCount}`);
    console.log(`  ❌ Falha ao iniciar:         ${failCount}`);
    console.log(`  📊 Total:                    ${failedPhotos.length}`);
    console.log(`  ⏱️  Tempo:                    ${seconds}s`);
    console.log('═'.repeat(50));

    if (successCount > 0) {
        console.log('\n⏳ O reconhecimento facial está sendo reprocessado em background.');
        console.log('   Aguarde alguns minutos e verifique o dashboard.');
        console.log('   Execute este script novamente para verificar se ainda há erros.');
    }
}

main().catch(err => {
    console.error('\n💥 Erro fatal:', err.message);
    process.exit(1);
});
