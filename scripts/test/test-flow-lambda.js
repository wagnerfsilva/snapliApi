/**
 * test-flow-lambda.js
 * Teste completo end-to-end do fluxo Lambda:
 *   1. Gera imagem sintética de teste
 *   2. Faz upload para S3 originals → dispara trigger automático
 *   3. Cria registro de photo no banco (status=pending)
 *   4. Aguarda 40s para o Lambda processar
 *   5. Verifica S3: watermarked + thumbnail criados
 *   6. Verifica banco: processingStatus, faceCount, keys atualizados via callback
 *   7. Puxa logs do CloudWatch para evidência
 */
require('dotenv').config();

const sharp = require('sharp');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
const { Sequelize } = require('sequelize');
const crypto = require('crypto');

const EVENT_ID    = '16633ae6-2d94-4bf0-86f1-26e813e24ecd';
const PHOTO_UUID  = crypto.randomUUID();
const ORIG_KEY    = `events/${EVENT_ID}/originals/${PHOTO_UUID}.jpg`;
const WM_KEY      = `events/${EVENT_ID}/watermarked/${PHOTO_UUID}.jpg`;
const THUMB_KEY   = `events/${EVENT_ID}/thumbnails/${PHOTO_UUID}.jpg`;
const ORIG_BUCKET = process.env.S3_BUCKET_ORIGINAL;
const WM_BUCKET   = process.env.S3_BUCKET_WATERMARKED;
const ADMIN_ID    = '59cb3e86-2c7b-46d0-aa0c-a413775f123b';
const REGION      = process.env.AWS_REGION;

const creds = { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY };
const s3    = new S3Client({ region: REGION, credentials: creds });
const cwl   = new CloudWatchLogsClient({ region: REGION, credentials: creds });
const seq   = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST, port: process.env.DB_PORT || 5432, dialect: 'postgres',
    dialectOptions: { ssl: { require: true, rejectUnauthorized: false } }, logging: false
});

async function s3Exists(bucket, key) {
    try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); return true; } catch { return false; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function line(char = '-', len = 55) { return char.repeat(len); }

async function run() {
    const startTime = Date.now();

    console.log(line('='));
    console.log('  TESTE COMPLETO DO FLUXO LAMBDA - SNAPLI');
    console.log(line('='));
    console.log(`  Evento  : Evento Teste Lambda`);
    console.log(`  EventID : ${EVENT_ID}`);
    console.log(`  PhotoID : ${PHOTO_UUID}`);
    console.log(line('='));
    console.log('');

    // -----------------------------------------------------------------------
    // 1. Gerar imagem de teste
    // -----------------------------------------------------------------------
    console.log('[1/6] Gerando imagem de teste (800x600px)...');
    const svg = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
      <rect width="800" height="600" fill="#1a365d"/>
      <rect x="0" y="200" width="800" height="200" fill="#2b6cb0" opacity="0.6"/>
      <text x="400" y="130" font-size="55" font-family="sans-serif" fill="white" text-anchor="middle">SNAPLI TEST</text>
      <text x="400" y="320" font-size="28" font-family="sans-serif" fill="#90cdf4" text-anchor="middle">Lambda Trigger Test</text>
      <text x="400" y="370" font-size="22" font-family="sans-serif" fill="#bee3f8" text-anchor="middle">${PHOTO_UUID.substring(0, 8)}</text>
      <text x="400" y="500" font-size="18" font-family="sans-serif" fill="#63b3ed" text-anchor="middle">${new Date().toISOString()}</text>
    </svg>`;

    const imgBuffer = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 26, g: 54, b: 93 } } })
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .jpeg({ quality: 85 })
        .toBuffer();
    console.log(`   Tamanho: ${(imgBuffer.length / 1024).toFixed(1)} KB`);
    console.log('   OK');

    // -----------------------------------------------------------------------
    // 2. Upload S3 originals → dispara trigger
    // -----------------------------------------------------------------------
    console.log('');
    console.log('[2/6] Upload para S3 originals (dispara trigger Lambda)...');
    console.log(`   s3://${ORIG_BUCKET}/${ORIG_KEY}`);
    await s3.send(new PutObjectCommand({
        Bucket: ORIG_BUCKET, Key: ORIG_KEY, Body: imgBuffer, ContentType: 'image/jpeg'
    }));
    const uploadedAt = Date.now();
    console.log('   Upload OK — trigger S3 -> Lambda disparado');

    // -----------------------------------------------------------------------
    // 3. Criar registro no banco
    // -----------------------------------------------------------------------
    console.log('');
    console.log('[3/6] Criando registro de photo no banco (status=pending)...');
    await seq.query(`
        INSERT INTO photos (id, "eventId", "originalFilename", "originalKey", "watermarkedKey", "thumbnailKey",
            width, height, "fileSize", "mimeType", "processingStatus", "uploadedBy", "createdAt", "updatedAt")
        VALUES (
            '${PHOTO_UUID}', '${EVENT_ID}', 'teste-lambda.jpg',
            '${ORIG_KEY}', '${WM_KEY}', '${THUMB_KEY}',
            800, 600, ${imgBuffer.length}, 'image/jpeg',
            'pending', '${ADMIN_ID}', NOW(), NOW()
        )
    `);
    console.log(`   Photo criada no banco: ${PHOTO_UUID}`);

    // -----------------------------------------------------------------------
    // 4. Aguardar Lambda
    // -----------------------------------------------------------------------
    console.log('');
    console.log('[4/6] Aguardando Lambda processar (40s)...');
    const steps = [10, 10, 10, 10];
    for (const s of steps) {
        await sleep(s * 1000);
        const wmReady = await s3Exists(WM_BUCKET, WM_KEY);
        process.stdout.write(`   ${wmReady ? '  Watermark JA apareceu no S3 ' : '  Aguardando...               '}\r`);
        if (wmReady) break;
    }
    console.log('   Verificando resultados...                    ');

    // -----------------------------------------------------------------------
    // 5. Verificar S3
    // -----------------------------------------------------------------------
    console.log('');
    console.log('[5/6] Verificando S3...');
    const hasOrig  = await s3Exists(ORIG_BUCKET, ORIG_KEY);
    const hasWm    = await s3Exists(WM_BUCKET, WM_KEY);
    const hasThumb = await s3Exists(WM_BUCKET, THUMB_KEY);

    console.log(`   ORIGINAL  [${ORIG_BUCKET}]`);
    console.log(`     ${ORIG_KEY}`);
    console.log(`     => ${hasOrig  ? 'EXISTE ✓' : 'NAO ENCONTRADO ✗'}`);
    console.log(`   WATERMARK [${WM_BUCKET}]`);
    console.log(`     ${WM_KEY}`);
    console.log(`     => ${hasWm    ? 'EXISTE ✓' : 'NAO ENCONTRADO ✗'}`);
    console.log(`   THUMBNAIL [${WM_BUCKET}]`);
    console.log(`     ${THUMB_KEY}`);
    console.log(`     => ${hasThumb ? 'EXISTE ✓' : 'NAO ENCONTRADO ✗'}`);

    // -----------------------------------------------------------------------
    // 6. Verificar banco
    // -----------------------------------------------------------------------
    console.log('');
    console.log('[6/6] Verificando banco de dados...');
    const [photos] = await seq.query(`
        SELECT id, "processingStatus", "faceCount", "rekognitionFaceId",
               "watermarkedKey", "thumbnailKey", "updatedAt"
        FROM photos WHERE id = '${PHOTO_UUID}'
    `);
    const p = photos[0];
    console.log(`   processingStatus  : ${p.processingStatus}`);
    console.log(`   watermarkedKey    : ${p.watermarkedKey}`);
    console.log(`   thumbnailKey      : ${p.thumbnailKey}`);
    console.log(`   faceCount         : ${p.faceCount}`);
    console.log(`   rekognitionFaceId : ${p.rekognitionFaceId || 'null (sem faces detectadas)'}`);
    console.log(`   updatedAt         : ${p.updatedAt}`);

    // -----------------------------------------------------------------------
    // CloudWatch logs (melhor esforço)
    // -----------------------------------------------------------------------
    console.log('');
    console.log('[+] Logs CloudWatch (ultimos eventos do Lambda)...');
    try {
        const cwResult = await cwl.send(new FilterLogEventsCommand({
            logGroupName: '/aws/lambda/snapli-image-processor',
            startTime: uploadedAt - 5000,
            filterPattern: PHOTO_UUID.substring(0, 8),
            limit: 20
        }));
        if (cwResult.events && cwResult.events.length > 0) {
            cwResult.events.forEach(e => console.log(`   ${new Date(e.timestamp).toISOString()} ${e.message.trim()}`));
        } else {
            // Try without filter to get any recent logs
            const cwAll = await cwl.send(new FilterLogEventsCommand({
                logGroupName: '/aws/lambda/snapli-image-processor',
                startTime: uploadedAt - 5000,
                limit: 30
            }));
            if (cwAll.events && cwAll.events.length > 0) {
                cwAll.events.slice(-15).forEach(e => console.log(`   ${new Date(e.timestamp).toISOString()} ${e.message.trim()}`));
            } else {
                console.log('   (nenhum log encontrado no periodo — Lambda pode ter iniciado cold start)');
            }
        }
    } catch (e) {
        console.log(`   (logs indisponiveis: ${e.message.substring(0, 80)})`);
    }

    // -----------------------------------------------------------------------
    // Resumo final
    // -----------------------------------------------------------------------
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const lambdaRan  = hasWm && hasThumb;
    const dbUpdated  = p.processingStatus === 'completed';
    const rekognOk   = p.faceCount !== null;

    console.log('');
    console.log(line('='));
    console.log('  RESULTADO FINAL');
    console.log(line('='));
    console.log(`  [${hasOrig  ? '✓' : '✗'}] Original no S3 (originals)`);
    console.log(`  [${hasWm    ? '✓' : '✗'}] Watermark no S3 (watermarked) - gerado pelo Lambda`);
    console.log(`  [${hasThumb ? '✓' : '✗'}] Thumbnail no S3 (thumbnails)  - gerado pelo Lambda`);
    console.log(`  [${rekognOk ? '✓' : '✗'}] Rekognition executado (faceCount=${p.faceCount})`);
    console.log(`  [${dbUpdated ? '✓' : '✗'}] Banco atualizado via callback (status=${p.processingStatus})`);
    console.log(line('-'));
    console.log(`  Tempo total: ${elapsed}s`);
    console.log(line('='));

    if (lambdaRan && dbUpdated) {
        console.log('  FLUXO 100% FUNCIONANDO');
    } else if (lambdaRan && !dbUpdated) {
        console.log('  Lambda OK (S3 gerado). Callback pendente.');
        console.log('  => Configure API_CALLBACK_URL no .env da Lambda com a URL da API em producao.');
    } else {
        console.log('  Lambda NAO executou. Verifique os logs acima.');
    }
    console.log(line('='));

    await seq.close();
    process.exit(lambdaRan ? 0 : 1);
}

run().catch(e => { console.error('Erro fatal:', e.message); process.exit(1); });
