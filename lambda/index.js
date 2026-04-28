// AWS SDK v3 is built-in on Lambda Node.js 18 runtime — do NOT bundle it
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { RekognitionClient, IndexFacesCommand, DetectFacesCommand } = require('@aws-sdk/client-rekognition');
const sharp = require('sharp');

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const rekognitionClient = new RekognitionClient({ region: process.env.AWS_REGION || 'us-east-1' });
// Env vars
const WATERMARKED_BUCKET = process.env.S3_BUCKET_WATERMARKED;
const REKOGNITION_COLLECTION_ID = process.env.REKOGNITION_COLLECTION_ID;
const WATERMARK_TEXT = process.env.WATERMARK_TEXT || 'SNAPLI';
const WATERMARK_OPACITY = parseFloat(process.env.WATERMARK_OPACITY) || 0.4;
const API_CALLBACK_URL = process.env.API_CALLBACK_URL; // e.g. https://api.snapli.com.br/api/internal/lambda-callback
const LAMBDA_INTERNAL_SECRET = process.env.LAMBDA_INTERNAL_SECRET;

/**
 * Lambda handler — triggered by S3 PUT on the originals bucket.
 * Generates watermarked image + thumbnail, runs Rekognition,
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

            // --- 3. Thumbnail ---
            const thumbnailBuffer = await createThumbnail(watermarkedBuffer);
            const thumbnailKey = originalKey.replace('/originals/', '/thumbnails/').replace(/\.[^.]+$/, '.jpg');

            await s3Client.send(new PutObjectCommand({
                Bucket: WATERMARKED_BUCKET,
                Key: thumbnailKey,
                Body: thumbnailBuffer,
                ContentType: 'image/jpeg',
                CacheControl: 'max-age=31536000'
            }));
            console.log(`Thumbnail: ${thumbnailKey}`);

            // --- 4. Rekognition ---
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

            // --- 5. Notify API ---
            await sendCallback({
                originalKey,
                watermarkedKey,
                thumbnailKey,
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
    const text = WATERMARK_TEXT;
    const opacity = WATERMARK_OPACITY;

    const resizedBuffer = await sharp(buffer)
        .resize(1920, null, { fit: 'inside', withoutEnlargement: true })
        .toBuffer();

    const meta = await sharp(resizedBuffer).metadata();
    const width = meta.width;
    const height = meta.height;
    const strokeW = 1;

    // Layer 1 — dense diagonal, -30°
    const fs1 = Math.max(Math.floor(width / 18), 18);
    const th1 = Math.ceil(fs1 * 1.3);
    const pw1 = Math.ceil(text.length * fs1 * 0.7 * 1.15);
    const ph1 = Math.ceil(th1 * 2.0);

    // Layer 2 — larger text, +40°
    const fs2 = Math.max(Math.floor(width / 9), 30);
    const th2 = Math.ceil(fs2 * 1.3);
    const pw2 = Math.ceil(text.length * fs2 * 0.7 * 1.3);
    const ph2 = Math.ceil(th2 * 2.5);

    // Layer 3 — micro dense text, -55°
    const fs3 = Math.max(Math.floor(width / 35), 12);
    const th3 = Math.ceil(fs3 * 1.3);
    const pw3 = Math.ceil(text.length * fs3 * 0.7 * 1.1);
    const ph3 = Math.ceil(th3 * 1.6);

    // Layer 4 — center band
    const fs4 = Math.max(Math.floor(width / 7), 40);
    const bandHeight = Math.ceil(height * 0.12);
    const bandY = Math.floor((height - bandHeight) / 2);

    const svgWatermark = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="wm1" width="${pw1}" height="${ph1}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
      <text x="0" y="${th1}" font-size="${fs1}" font-weight="bold"
        font-family="DejaVu Sans, Liberation Sans, sans-serif" fill="white" fill-opacity="${opacity}"
        stroke="black" stroke-opacity="${opacity * 0.5}" stroke-width="${strokeW}">${text}</text>
    </pattern>
    <pattern id="wm2" width="${pw2}" height="${ph2}" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
      <text x="0" y="${th2}" font-size="${fs2}" font-weight="bold"
        font-family="DejaVu Sans, Liberation Sans, sans-serif" fill="white" fill-opacity="${opacity * 0.7}"
        stroke="black" stroke-opacity="${opacity * 0.35}" stroke-width="${strokeW}">${text}</text>
    </pattern>
    <pattern id="wm3" width="${pw3}" height="${ph3}" patternUnits="userSpaceOnUse" patternTransform="rotate(-55)">
      <text x="0" y="${th3}" font-size="${fs3}" font-weight="bold"
        font-family="DejaVu Sans, Liberation Sans, sans-serif" fill="white" fill-opacity="${opacity * 0.6}"
        stroke="black" stroke-opacity="${opacity * 0.3}" stroke-width="${Math.max(strokeW * 0.5, 0.5)}">${text}</text>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#wm1)"/>
  <rect width="100%" height="100%" fill="url(#wm2)"/>
  <rect width="100%" height="100%" fill="url(#wm3)"/>
  <rect x="0" y="${bandY}" width="100%" height="${bandHeight}" fill="black" fill-opacity="${opacity * 0.4}"/>
  <text x="${Math.floor(width / 2)}" y="${bandY + Math.floor(bandHeight / 2) + Math.floor(fs4 * 0.35)}" font-size="${fs4}" font-weight="bold"
    font-family="DejaVu Sans, Liberation Sans, sans-serif" fill="white" fill-opacity="${Math.min(opacity * 2, 0.85)}"
    stroke="black" stroke-opacity="${opacity * 0.6}" stroke-width="${strokeW * 2}" text-anchor="middle" letter-spacing="${Math.floor(fs4 * 0.25)}">${text}</text>
</svg>`;

    return await sharp(resizedBuffer)
        .composite([{ input: Buffer.from(svgWatermark), top: 0, left: 0 }])
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();
}

// ---------------------------------------------------------------------------
// Thumbnail — 300x300 cover crop from watermarked buffer
// ---------------------------------------------------------------------------
async function createThumbnail(buffer) {
    return await sharp(buffer)
        .resize(300, 300, { fit: 'cover', position: 'center' })
        .jpeg({ quality: 80 })
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
