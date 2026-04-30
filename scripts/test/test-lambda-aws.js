/**
 * test-lambda-aws.js
 *
 * Testa o Lambda na AWS sem alterar o fluxo da API:
 *   1. Busca uma foto existente no banco (status = completed, tem originalKey)
 *   2. Invoca o Lambda diretamente com um evento S3 simulado
 *   3. Aguarda processamento (polling CloudWatch Logs)
 *   4. Verifica se watermarked + thumbnail foram criados no S3
 *   5. Verifica se o callback atualizou o banco
 *
 * Uso:
 *   node scripts/test/test-lambda-aws.js [--photoId <uuid>] [--key <s3key>]
 *
 * Se nenhum argumento for passado, usa a primeira foto encontrada no banco.
 *
 * Requer:
 *   - AWS CLI configurado
 *   - .env com DATABASE_URL (ou DB_HOST etc) + AWS vars + LAMBDA_INTERNAL_SECRET
 */

require('dotenv').config();

const { execSync, spawn } = require('child_process');
const path = require('path');

// AWS SDK (already in snapliApi/node_modules)
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const FUNCTION_NAME = 'snapli-image-processor';
const ORIGINAL_BUCKET = process.env.S3_BUCKET_ORIGINAL;
const WATERMARKED_BUCKET = process.env.S3_BUCKET_WATERMARKED;

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------
function awsCli(args, options = {}) {
    try {
        return execSync(`aws ${args} --region ${AWS_REGION} --output json`, {
            encoding: 'utf8',
            ...options
        });
    } catch (err) {
        throw new Error(`AWS CLI error: ${err.stderr || err.message}`);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function s3ObjectExists(bucket, key) {
    const s3 = new S3Client({ region: AWS_REGION });
    try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
    } catch {
        return false;
    }
}

// -----------------------------------------------------------------------
// Get a photo to test with
// -----------------------------------------------------------------------
async function getTestPhoto(photoId, key) {
    // Dynamically require Sequelize models (uses project's own config)
    const { Photo } = require('../../src/models');

    let photo;
    if (photoId) {
        photo = await Photo.findByPk(photoId);
        if (!photo) throw new Error(`Photo ${photoId} not found in DB`);
    } else if (key) {
        photo = await Photo.findOne({ where: { originalKey: key } });
        if (!photo) throw new Error(`No photo with originalKey=${key}`);
    } else {
        // Pick the most recent completed photo that has an originalKey
        photo = await Photo.findOne({
            where: {
                processingStatus: 'completed',
                originalKey: { [require('sequelize').Op.ne]: null }
            },
            order: [['createdAt', 'DESC']]
        });
        if (!photo) throw new Error('No suitable photo found in DB. Upload at least one photo first.');
    }
    return photo;
}

// -----------------------------------------------------------------------
// Build a fake S3 event payload
// -----------------------------------------------------------------------
function buildS3Event(bucketName, objectKey) {
    return {
        Records: [
            {
                eventVersion: '2.1',
                eventSource: 'aws:s3',
                awsRegion: AWS_REGION,
                eventTime: new Date().toISOString(),
                eventName: 'ObjectCreated:Put',
                s3: {
                    s3SchemaVersion: '1.0',
                    configurationId: 'test-invoke',
                    bucket: {
                        name: bucketName,
                        arn: `arn:aws:s3:::${bucketName}`
                    },
                    object: {
                        key: objectKey,
                        size: 500000,
                        eTag: 'test-etag'
                    }
                }
            }
        ]
    };
}

// -----------------------------------------------------------------------
// Invoke Lambda and capture result
// -----------------------------------------------------------------------
function invokeLambda(eventPayload) {
    const fs = require('fs');
    const os = require('os');
    const tmpEvent = path.join(os.tmpdir(), `snapli-test-event-${Date.now()}.json`);
    const tmpResponse = path.join(os.tmpdir(), `snapli-test-response-${Date.now()}.json`);

    fs.writeFileSync(tmpEvent, JSON.stringify(eventPayload));

    try {
        const logResult = execSync(
            `aws lambda invoke \
                --function-name ${FUNCTION_NAME} \
                --payload file://${tmpEvent} \
                --log-type Tail \
                --cli-binary-format raw-in-base64-out \
                --region ${AWS_REGION} \
                ${tmpResponse}`,
            { encoding: 'utf8' }
        );

        const invocationMeta = JSON.parse(logResult);
        const responseBody = fs.readFileSync(tmpResponse, 'utf8');

        // Decode CloudWatch log tail (base64)
        const logTail = invocationMeta.LogResult
            ? Buffer.from(invocationMeta.LogResult, 'base64').toString('utf8')
            : '';

        return {
            statusCode: invocationMeta.StatusCode,
            functionError: invocationMeta.FunctionError || null,
            responseBody,
            logTail
        };
    } finally {
        try { require('fs').unlinkSync(tmpEvent); } catch {}
        try { require('fs').unlinkSync(tmpResponse); } catch {}
    }
}

// -----------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------
async function main() {
    const args = process.argv.slice(2);
    let photoId = null;
    let s3Key = null;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--photoId') photoId = args[++i];
        if (args[i] === '--key') s3Key = args[++i];
    }

    if (!ORIGINAL_BUCKET) {
        console.error('ERROR: S3_BUCKET_ORIGINAL not set in .env');
        process.exit(1);
    }
    if (!WATERMARKED_BUCKET) {
        console.error('ERROR: S3_BUCKET_WATERMARKED not set in .env');
        process.exit(1);
    }

    console.log('');
    console.log('=== snapli Lambda Test ===');
    console.log(`Function  : ${FUNCTION_NAME}`);
    console.log(`Region    : ${AWS_REGION}`);
    console.log(`Originals : ${ORIGINAL_BUCKET}`);
    console.log(`Watermark : ${WATERMARKED_BUCKET}`);
    console.log('');

    // 1. Get photo
    console.log('1. Finding test photo...');
    const photo = await getTestPhoto(photoId, s3Key);
    const originalKey = photo.originalKey;

    console.log(`   Photo ID    : ${photo.id}`);
    console.log(`   Original key: ${originalKey}`);
    console.log(`   Status before: ${photo.processingStatus}`);
    console.log('');

    // Expected output keys (Lambda derives them from originalKey)
    const expectedWatermarkedKey = originalKey.replace('/originals/', '/watermarked/').replace(/\.[^.]+$/, '.jpg');
    const expectedThumbnailKey   = originalKey.replace('/originals/', '/thumbnails/').replace(/\.[^.]+$/, '.jpg');

    console.log('   Expected watermarked key:', expectedWatermarkedKey);
    console.log('   Expected thumbnail key  :', expectedThumbnailKey);
    console.log('');

    // 2. Invoke Lambda
    console.log('2. Invoking Lambda...');
    const s3Event = buildS3Event(ORIGINAL_BUCKET, originalKey);
    const result = invokeLambda(s3Event);

    console.log(`   Status code   : ${result.statusCode}`);
    if (result.functionError) {
        console.log(`   Function error: ${result.functionError}`);
    }
    console.log('');
    console.log('--- Lambda Log Tail ---');
    console.log(result.logTail);
    console.log('---');
    console.log('');

    if (result.functionError) {
        console.error('FAIL: Lambda returned a function error. Check log tail above.');
        process.exit(1);
    }

    // 3. Verify S3 output
    console.log('3. Verifying S3 output...');
    const hasWatermarked = await s3ObjectExists(WATERMARKED_BUCKET, expectedWatermarkedKey);
    const hasThumbnail   = await s3ObjectExists(WATERMARKED_BUCKET, expectedThumbnailKey);

    console.log(`   Watermarked exists: ${hasWatermarked ? 'YES ✓' : 'NO ✗'}`);
    console.log(`   Thumbnail exists  : ${hasThumbnail   ? 'YES ✓' : 'NO ✗'}`);
    console.log('');

    // 4. Verify DB callback (re-fetch)
    console.log('4. Verifying DB callback...');
    await sleep(1000); // brief pause for async DB write
    const { Photo } = require('../../src/models');
    const updatedPhoto = await Photo.findByPk(photo.id);

    console.log(`   processingStatus : ${updatedPhoto.processingStatus}`);
    console.log(`   watermarkedKey   : ${updatedPhoto.watermarkedKey}`);
    console.log(`   thumbnailKey     : ${updatedPhoto.thumbnailKey}`);
    console.log(`   faceCount        : ${updatedPhoto.faceCount}`);
    console.log('');

    // 5. Summary
    const callbackOk = updatedPhoto.processingStatus === 'completed'
        && updatedPhoto.watermarkedKey === expectedWatermarkedKey;

    const allOk = hasWatermarked && hasThumbnail && callbackOk;

    if (allOk) {
        console.log('=== RESULT: ALL CHECKS PASSED ✓ ===');
        console.log('The Lambda is working correctly. You can now:');
        console.log('  1. Confirm via CloudWatch that logs match expectations');
        console.log('  2. Visually inspect the watermarked image in S3');
        console.log('  3. Proceed to update the API to skip watermarking on upload');
    } else {
        console.log('=== RESULT: SOME CHECKS FAILED ===');
        if (!hasWatermarked) console.log('  ✗ Watermarked image not found in S3');
        if (!hasThumbnail)   console.log('  ✗ Thumbnail not found in S3');
        if (!callbackOk)     console.log('  ✗ DB not updated via callback (check API_CALLBACK_URL and LAMBDA_INTERNAL_SECRET)');
        process.exit(1);
    }

    process.exit(0);
}

main().catch(err => {
    console.error('Unhandled error:', err.message);
    process.exit(1);
});
