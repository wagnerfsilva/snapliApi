/**
 * Reprocessa fotos stuck (pending) ou com falha de callback (failed) re-invocando a Lambda diretamente.
 * Uso: node scripts/setup/reprocess-event-photos.js <eventId>
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');
const db = require(path.join(__dirname, '../../src/models'));

const EVENT_ID = process.argv[2] || 'ab00f274-ea68-4749-9a7f-3cf0aef3d5b8';
const ORIGINALS_BUCKET = 'snapli-originals';
const LAMBDA_NAME = 'snapli-image-processor';
const DELAY_MS = 2000;

const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fileExistsInS3(key) {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: ORIGINALS_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function invokeLambda(originalKey) {
  const payload = {
    Records: [{
      s3: {
        bucket: { name: ORIGINALS_BUCKET },
        object: { key: originalKey },
      },
    }],
  };

  const cmd = new InvokeCommand({
    FunctionName: LAMBDA_NAME,
    InvocationType: 'Event', // async - fire and forget
    Payload: Buffer.from(JSON.stringify(payload)),
  });

  const response = await lambdaClient.send(cmd);
  return response.StatusCode; // 202 = accepted
}

async function main() {
  const { Op } = require('sequelize');

  const photos = await db.Photo.findAll({
    where: {
      eventId: EVENT_ID,
      processingStatus: { [Op.in]: ['pending', 'failed'] },
    },
    attributes: ['id', 'originalKey', 'processingStatus', 'processingError'],
    raw: true,
  });

  console.log(`\nEncontradas ${photos.length} fotos para reprocessar no evento ${EVENT_ID}`);
  console.log('(pending: ' + photos.filter(p => p.processingStatus === 'pending').length + ', failed: ' + photos.filter(p => p.processingStatus === 'failed').length + ')\n');

  // Marcar todas como pending para que o callback possa atualizar para completed
  await db.Photo.update(
    { processingStatus: 'pending', processingError: null },
    { where: { eventId: EVENT_ID, processingStatus: { [Op.in]: ['pending', 'failed'] } } }
  );
  console.log('✅ Marcadas como pending\n');

  let ok = 0, skip = 0, fail = 0;

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const prefix = `[${i + 1}/${photos.length}]`;

    const exists = await fileExistsInS3(photo.originalKey);
    if (!exists) {
      console.log(`${prefix} ⚠️  Arquivo não encontrado no S3: ${photo.originalKey}`);
      skip++;
      continue;
    }

    try {
      const statusCode = await invokeLambda(photo.originalKey);
      console.log(`${prefix} 🚀 ${photo.originalKey.split('/').pop()} → Lambda invocada (HTTP ${statusCode})`);
      ok++;
    } catch (e) {
      console.log(`${prefix} ❌ Erro ao invocar Lambda: ${e.message}`);
      fail++;
    }

    if (i < photos.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n=== Resultado ===`);
  console.log(`Invocadas: ${ok} | Sem arquivo no S3: ${skip} | Erros: ${fail}`);
  console.log('\nAguarde ~30s e verifique o painel do evento para confirmar que as fotos foram processadas.');
}

main().catch(console.error).finally(() => db.sequelize.close());
