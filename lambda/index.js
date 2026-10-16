// AWS SDK v3 is built-in on Lambda Node.js 18 runtime — do NOT bundle it
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { RekognitionClient, IndexFacesCommand, DetectFacesCommand } = require('@aws-sdk/client-rekognition');
const sharp = require('sharp');
const { createWatermarkSvg } = require('./shared/watermark');

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const rekognitionClient = new RekognitionClient({ region: process.env.AWS_REGION || 'us-east-1' });
// Env vars
const WATERMARKED_BUCKET = process.env.S3_BUCKET_WATERMARKED;
const REKOGNITION_COLLECTION_ID = process.env.REKOGNITION_COLLECTION_ID;
const API_CALLBACK_URL = process.env.API_CALLBACK_URL; // e.g. https://api.snapli.com.br/api/internal/lambda-callback
const LAMBDA_INTERNAL_SECRET = process.env.LAMBDA_INTERNAL_SECRET;

/**
 * Lambda handler — triggered by S3 PUT on the originals bucket.
 * Generates watermarked image, runs Rekognition,
 * then notifies the API via HTTP callback so the DB record is updated.
 */
exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));

    for (const record of event.Records) {
        const originalKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        const bucket = record.s3.bucket.name;

        // Only process images under events/.../originals/
        if (!originalKey.includes('/originals/')) {
            console.log(`Skipping non-original key: ${originalKey}`);
            continue;
        }

        console.log(`Processing: ${bucket}/${originalKey}`);

        try {
            // --- 1. Download original from S3 ---
            const getResult = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: originalKey }));
            const chunks = [];
            for await (const chunk of getResult.Body) {
                chunks.push(chunk);
            }
            const imageBuffer = Buffer.concat(chunks);

            const metadata = await sharp(imageBuffer).metadata();
            console.log(`Dimensions: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);

            // --- 2. Watermarked image ---
            const watermarkedBuffer = await applyWatermark(imageBuffer);
            const watermarkedKey = originalKey.replace('/originals/', '/watermarked/').replace(/\.[^.]+$/, '.jpg');

            await s3Client.send(new PutObjectCommand({
                Bucket: WATERMARKED_BUCKET,
                Key: watermarkedKey,
                Body: watermarkedBuffer,
                ContentType: 'image/jpeg',
                CacheControl: 'max-age=31536000'
            }));
            console.log(`Watermarked: ${watermarkedKey}`);

            // --- 3. Rekognition ---
            let faceCount = 0;
            let faceData = [];
            let rekognitionFaceId = null;

            if (REKOGNITION_COLLECTION_ID) {
                try {
                    // Rekognition has a 5MB limit — resize if needed
                    let rekBuffer = imageBuffer;
                    if (imageBuffer.length > 4.5 * 1024 * 1024) {
                        rekBuffer = await resizeForRekognition(imageBuffer);
                    }

                    const detectResult = await rekognitionClient.send(new DetectFacesCommand({
                        Image: { Bytes: rekBuffer },
                        Attributes: ['ALL']
                    }));

                    faceCount = detectResult.FaceDetails?.length || 0;
                    console.log(`Detected ${faceCount} face(s)`);

                    if (faceCount > 0) {
                        const filenameNoExt = originalKey.split('/').pop().replace(/\.[^.]+$/, '');
                        const indexResult = await rekognitionClient.send(new IndexFacesCommand({
                            CollectionId: REKOGNITION_COLLECTION_ID,
                            Image: { Bytes: rekBuffer },
                            ExternalImageId: filenameNoExt,
                            DetectionAttributes: ['ALL'],
                            MaxFaces: 10,
                            QualityFilter: 'AUTO'
                        }));

                        const indexedFaces = indexResult.FaceRecords || [];
                        rekognitionFaceId = indexedFaces[0]?.Face?.FaceId || null;
                        faceData = indexedFaces.map(r => ({
                            faceId: r.Face?.FaceId,
                            confidence: r.Face?.Confidence,
                            boundingBox: r.Face?.BoundingBox
                        }));
                        console.log(`Indexed ${indexedFaces.length} face(s), faceId: ${rekognitionFaceId}`);
                    }
                } catch (rekError) {
                    console.error('Rekognition error (non-fatal):', rekError.message);
                }
            }

            // --- 4. Notify API ---
            await sendCallback({
                originalKey,
                watermarkedKey,
                faceCount,
                faceData,
                rekognitionFaceId,
                processingStatus: 'completed'
            });

            console.log(`Done: ${originalKey}`);

        } catch (error) {
            console.error(`Error processing ${originalKey}:`, error);

            // Best-effort: notify API of failure
            await sendCallback({
                originalKey,
                processingStatus: 'failed',
                processingError: error.message
            }).catch(e => console.error('Callback error on failure:', e.message));
        }
    }

    return { statusCode: 200, body: 'OK' };
};

// ---------------------------------------------------------------------------
// Watermark — 4-layer SVG (ported from src/services/image.service.js)
// Uses DejaVu Sans / Liberation Sans which are available on Amazon Linux 2
// ---------------------------------------------------------------------------
async function applyWatermark(buffer) {
    const resizedBuffer = await sharp(buffer)
        .resize(1920, null, { fit: 'inside', withoutEnlargement: true })
        .toBuffer();

    const meta = await sharp(resizedBuffer).metadata();
    const width = meta.width;
    const height = meta.height;
    const svgWatermark = createWatermarkSvg(width, height);

    return await sharp(resizedBuffer)
        .composite([{ input: Buffer.from(svgWatermark), top: 0, left: 0 }])
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();
}

// ---------------------------------------------------------------------------
// Resize for Rekognition 5MB limit
// ---------------------------------------------------------------------------
async function resizeForRekognition(buffer, maxBytes = 4.5 * 1024 * 1024) {
    const meta = await sharp(buffer).metadata();
    let quality = 85;
    let scale = 1;
    let result = buffer;

    while (result.length > maxBytes && (quality > 30 || scale > 0.3)) {
        if (quality > 40) {
            quality -= 10;
        } else {
            scale = Math.max(scale - 0.1, 0.3);
        }
        const newWidth = Math.round(meta.width * scale);
        result = await sharp(buffer)
            .resize(newWidth, null, { fit: 'inside' })
            .jpeg({ quality })
            .toBuffer();
    }
    return result;
}

// ---------------------------------------------------------------------------
// HTTP callback to API — updates the Photo record via originalKey lookup
// ---------------------------------------------------------------------------
async function sendCallback(payload) {
    if (!API_CALLBACK_URL || !LAMBDA_INTERNAL_SECRET) {
        console.warn('API_CALLBACK_URL or LAMBDA_INTERNAL_SECRET not set — skipping callback');
        return;
    }

    const response = await fetch(API_CALLBACK_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-lambda-secret': LAMBDA_INTERNAL_SECRET
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Callback failed: ${response.status} ${body}`);
    }

    console.log(`Callback sent for ${payload.originalKey} → ${response.status}`);
}
