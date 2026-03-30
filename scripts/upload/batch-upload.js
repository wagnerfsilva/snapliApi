#!/usr/bin/env node

/**
 * Snapli - Script de Upload em Lote de Fotos
 * 
 * Uso:
 *   node batch-upload.js [pasta] [eventId]
 * 
 * Exemplos:
 *   node batch-upload.js
 *   node batch-upload.js /caminho/para/fotos
 *   node batch-upload.js /caminho/para/fotos meu-event-id
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');

// ============================================================
// CONFIGURAÇÃO - Altere aqui ou passe via argumentos CLI
// ============================================================
const CONFIG = {
    FOLDER_PATH: process.argv[2] || '/Users/pulpa/Downloads/Editadas/',
    EVENT_ID: process.argv[3] || '803bff31-1dab-4ef9-8223-5a0ade60ca32',
    API_URL: process.env.API_URL || 'https://snapliapi-production.up.railway.app/api',
    LOGIN: process.env.LOGIN || 'fotografo@gmail.com',
    SENHA: process.env.SENHA || '%65434343',
    BATCH_SIZE: 5,                    // Fotos por lote (conservador para evitar timeout)
    DELAY_BETWEEN_BATCHES: 2000,      // 2s entre lotes
    MAX_RETRIES: 3,                   // Tentativas por lote
    REQUEST_TIMEOUT: 180000,          // 3 minutos por lote
    MAX_FILE_SIZE: 10 * 1024 * 1024,  // 10MB (limite da API)
};

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const PROGRESS_FILE = path.join(__dirname, 'upload-progress.json');

// ============================================================
// UTILIDADES
// ============================================================

function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// PROGRESSO (para retomada)
// ============================================================

function loadProgress() {
    try {
        if (fs.existsSync(PROGRESS_FILE)) {
            const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
            // Só retoma se for o mesmo evento e pasta
            if (data.eventId === CONFIG.EVENT_ID && data.folder === CONFIG.FOLDER_PATH) {
                return data;
            }
        }
    } catch (err) {
        console.warn('⚠️  Erro ao ler progresso anterior, começando do zero:', err.message);
    }
    return {
        eventId: CONFIG.EVENT_ID,
        folder: CONFIG.FOLDER_PATH,
        totalFiles: 0,
        uploadedFiles: [],
        failedFiles: [],
        startedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
    };
}

function saveProgress(progress) {
    progress.lastUpdatedAt = new Date().toISOString();
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');
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
// DESCOBERTA DE ARQUIVOS
// ============================================================

function discoverFiles() {
    const folderPath = CONFIG.FOLDER_PATH;
    
    if (!fs.existsSync(folderPath)) {
        throw new Error(`Pasta não encontrada: ${folderPath}`);
    }

    const allFiles = fs.readdirSync(folderPath);
    const imageFiles = [];
    const skipped = { format: [], size: [] };

    for (const file of allFiles) {
        const ext = path.extname(file).toLowerCase();
        const fullPath = path.join(folderPath, file);

        // Ignorar diretórios e arquivos ocultos
        if (!fs.statSync(fullPath).isFile() || file.startsWith('.')) continue;

        // Verificar extensão
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
            skipped.format.push(file);
            continue;
        }

        // Verificar tamanho
        const stats = fs.statSync(fullPath);
        if (stats.size > CONFIG.MAX_FILE_SIZE) {
            skipped.size.push({ file, size: formatSize(stats.size) });
            continue;
        }

        imageFiles.push({
            name: file,
            path: fullPath,
            size: stats.size,
        });
    }

    // Ordenar alfabeticamente
    imageFiles.sort((a, b) => a.name.localeCompare(b.name));

    // Reportar arquivos ignorados
    if (skipped.format.length > 0) {
        console.log(`⚠️  ${skipped.format.length} arquivo(s) ignorado(s) por formato inválido: ${skipped.format.slice(0, 5).join(', ')}${skipped.format.length > 5 ? '...' : ''}`);
    }
    if (skipped.size.length > 0) {
        console.log(`⚠️  ${skipped.size.length} arquivo(s) ignorado(s) por exceder 10MB:`);
        skipped.size.forEach(s => console.log(`   - ${s.file} (${s.size})`));
    }

    return imageFiles;
}

// ============================================================
// UPLOAD DE UM LOTE
// ============================================================

async function uploadBatch(files, token, batchNum, totalBatches) {
    const form = new FormData();
    form.append('eventId', CONFIG.EVENT_ID);

    for (const file of files) {
        form.append('photos', fs.createReadStream(file.path), {
            filename: file.name,
            contentType: getContentType(file.name),
        });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

    try {
        const response = await fetch(`${CONFIG.API_URL}/photos/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                ...form.getHeaders(),
            },
            body: form,
            signal: controller.signal,
        });

        clearTimeout(timeout);

        const data = await response.json();

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${data.message || response.statusText}`);
        }

        return data;
    } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
            throw new Error(`Timeout após ${CONFIG.REQUEST_TIMEOUT / 1000}s`);
        }
        throw err;
    }
}

function getContentType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const types = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
    };
    return types[ext] || 'image/jpeg';
}

// ============================================================
// LOOP PRINCIPAL
// ============================================================

async function main() {
    const startTime = Date.now();

    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║       SNAPLI - Upload em Lote de Fotos      ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
    console.log(`📁 Pasta:    ${CONFIG.FOLDER_PATH}`);
    console.log(`🎯 Evento:   ${CONFIG.EVENT_ID}`);
    console.log(`🌐 API:      ${CONFIG.API_URL}`);
    console.log(`📦 Lote:     ${CONFIG.BATCH_SIZE} fotos por vez`);
    console.log('');

    // 1. Autenticar
    const token = await authenticate();

    // 2. Descobrir arquivos
    console.log('\n📂 Buscando fotos...');
    const allFiles = discoverFiles();
    console.log(`   Encontradas: ${allFiles.length} fotos válidas`);

    if (allFiles.length === 0) {
        console.log('\n❌ Nenhuma foto encontrada para enviar.');
        return;
    }

    // 3. Carregar progresso anterior
    const progress = loadProgress();
    const alreadyUploaded = new Set(progress.uploadedFiles);
    const pendingFiles = allFiles.filter(f => !alreadyUploaded.has(f.name));

    if (alreadyUploaded.size > 0) {
        console.log(`\n♻️  Retomando upload: ${alreadyUploaded.size} já enviadas, ${pendingFiles.length} pendentes`);
    }

    if (pendingFiles.length === 0) {
        console.log('\n✅ Todas as fotos já foram enviadas!');
        return;
    }

    progress.totalFiles = allFiles.length;
    saveProgress(progress);

    // 4. Dividir em lotes
    const batches = [];
    for (let i = 0; i < pendingFiles.length; i += CONFIG.BATCH_SIZE) {
        batches.push(pendingFiles.slice(i, i + CONFIG.BATCH_SIZE));
    }

    const totalSize = pendingFiles.reduce((sum, f) => sum + f.size, 0);
    console.log(`\n📊 Total a enviar: ${pendingFiles.length} fotos (${formatSize(totalSize)}) em ${batches.length} lotes`);
    console.log('─'.repeat(50));

    // 5. Enviar lotes
    let uploadedCount = alreadyUploaded.size;
    let failedCount = 0;
    let batchErrors = [];

    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchNum = i + 1;
        const fileNames = batch.map(f => f.name).join(', ');

        process.stdout.write(`\n📤 [Lote ${batchNum}/${batches.length}] Enviando ${batch.length} fotos... `);

        let success = false;
        let lastError = null;

        for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
            try {
                const result = await uploadBatch(batch, token, batchNum, batches.length);

                if (result.success) {
                    const uploaded = result.data.uploaded || [];
                    const errors = result.data.errors || [];

                    // Registrar sucessos
                    for (const file of batch) {
                        const hasError = errors.some(e => e.filename === file.name);
                        if (!hasError) {
                            progress.uploadedFiles.push(file.name);
                            uploadedCount++;
                        } else {
                            progress.failedFiles.push(file.name);
                            failedCount++;
                        }
                    }

                    saveProgress(progress);

                    const pct = Math.round((uploadedCount / allFiles.length) * 100);
                    console.log(`✅ OK (${uploadedCount}/${allFiles.length} = ${pct}%)`);
                    
                    if (errors.length > 0) {
                        errors.forEach(e => console.log(`   ⚠️  Erro: ${e.filename}: ${e.error}`));
                    }

                    // Mostrar nomes dos arquivos enviados
                    console.log(`   📎 ${fileNames}`);
                    
                    success = true;
                    break;
                } else {
                    throw new Error(result.message || 'Resposta sem sucesso');
                }
            } catch (err) {
                lastError = err;
                if (attempt < CONFIG.MAX_RETRIES) {
                    const waitTime = Math.pow(2, attempt) * 1000; // Backoff exponencial
                    console.log(`\n   ⚠️  Tentativa ${attempt}/${CONFIG.MAX_RETRIES} falhou: ${err.message}`);
                    console.log(`   ⏳ Aguardando ${waitTime / 1000}s antes de tentar novamente...`);
                    await sleep(waitTime);
                }
            }
        }

        if (!success) {
            console.log(`❌ FALHOU após ${CONFIG.MAX_RETRIES} tentativas`);
            console.log(`   Erro: ${lastError?.message}`);
            console.log(`   📎 ${fileNames}`);
            
            for (const file of batch) {
                progress.failedFiles.push(file.name);
                failedCount++;
            }
            saveProgress(progress);
            
            batchErrors.push({ batch: batchNum, files: batch.map(f => f.name), error: lastError?.message });
        }

        // Delay entre lotes (exceto o último)
        if (i < batches.length - 1) {
            await sleep(CONFIG.DELAY_BETWEEN_BATCHES);
        }
    }

    // 6. Resumo final
    const elapsed = Date.now() - startTime;
    
    console.log('\n');
    console.log('═'.repeat(50));
    console.log('            RESUMO DO UPLOAD');
    console.log('═'.repeat(50));
    console.log(`  ✅ Enviadas com sucesso: ${uploadedCount}`);
    console.log(`  ❌ Falhas:               ${failedCount}`);
    console.log(`  📊 Total:                ${allFiles.length}`);
    console.log(`  ⏱️  Tempo total:          ${formatTime(elapsed)}`);
    console.log('═'.repeat(50));

    if (batchErrors.length > 0) {
        console.log('\n⚠️  Lotes com erro:');
        batchErrors.forEach(e => {
            console.log(`   Lote ${e.batch}: ${e.error}`);
            console.log(`   Arquivos: ${e.files.join(', ')}`);
        });
        console.log('\n💡 Execute o script novamente para tentar reenviar os arquivos com falha.');
    }

    if (failedCount === 0 && uploadedCount === allFiles.length) {
        console.log('\n🎉 Todas as fotos foram enviadas com sucesso!');
        // Limpar arquivo de progresso
        if (fs.existsSync(PROGRESS_FILE)) {
            fs.unlinkSync(PROGRESS_FILE);
            console.log('🗑️  Arquivo de progresso removido.');
        }
    }
}

// ============================================================
// EXECUÇÃO
// ============================================================

main().catch(err => {
    console.error('\n💥 Erro fatal:', err.message);
    process.exit(1);
});
