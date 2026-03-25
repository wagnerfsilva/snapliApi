const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { RekognitionClient, IndexFacesCommand, DetectFacesCommand } = require('@aws-sdk/client-rekognition');
const sharp = require('sharp');

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const rekognitionClient = new RekognitionClient({ region: process.env.AWS_REGION });

/**
 * Lambda handler for processing images uploaded to S3
 * Triggered when a new image is uploaded to the original bucket
 */
exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));

    for (const record of event.Records) {
        try {
            const bucket = record.s3.bucket.name;
            const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

            console.log(`Processing: ${bucket}/${key}`);

            // Get the image from S3
            const getObjectCommand = new GetObjectCommand({ Bucket: bucket, Key: key });
            const imageObject = await s3Client.send(getObjectCommand);

            // Convert stream to buffer
            const chunks = [];
            for await (const chunk of imageObject.Body) {
                chunks.push(chunk);
            }
            const imageBuffer = Buffer.concat(chunks);

            // Get image metadata
            const metadata = await sharp(imageBuffer).metadata();
            console.log(`Image dimensions: ${metadata.width}x${metadata.height}`);

            // 1. Create watermarked version
            const watermarkedBuffer = await createWatermarkedImage(imageBuffer, metadata);
            const watermarkedKey = key.replace('/originals/', '/watermarked/');

            await s3Client.send(new PutObjectCommand({
                Bucket: process.env.WATERMARKED_BUCKET,
                Key: watermarkedKey,
                Body: watermarkedBuffer,
                ContentType: 'image/jpeg',
                CacheControl: 'max-age=31536000'
            }));
            console.log(`Watermarked image created: ${watermarkedKey}`);

            // 2. Create thumbnail
            const thumbnailBuffer = await createThumbnail(imageBuffer);
            const thumbnailKey = key.replace('/originals/', '/thumbnails/');

            await s3Client.send(new PutObjectCommand({
                Bucket: process.env.WATERMARKED_BUCKET,
                Key: thumbnailKey,
                Body: thumbnailBuffer,
                ContentType: 'image/jpeg',
                CacheControl: 'max-age=31536000'
            }));
            console.log(`Thumbnail created: ${thumbnailKey}`);

            // 3. Detect and index faces with Rekognition
            const photoId = key.split('/').pop().split('.')[0];

            try {
                const detectResult = await rekognitionClient.send(new DetectFacesCommand({
                    Image: { Bytes: imageBuffer },
                    Attributes: ['ALL']
                }));

                const faceCount = detectResult.FaceDetails?.length || 0;
                console.log(`Detected ${faceCount} face(s)`);

                if (faceCount > 0) {
                    // Index faces in Rekognition collection
                    const indexResult = await rekognitionClient.send(new IndexFacesCommand({
                        CollectionId: process.env.REKOGNITION_COLLECTION_ID,
                        Image: { Bytes: imageBuffer },
                        ExternalImageId: photoId,
                        DetectionAttributes: ['ALL'],
                        MaxFaces: 10,
                        QualityFilter: 'AUTO'
                    }));

                    console.log(`Indexed ${indexResult.FaceRecords?.length || 0} face(s)`);
                }
            } catch (rekError) {
                console.error('Rekognition error:', rekError);
                // Continue processing even if face detection fails
            }

            console.log(`Successfully processed: ${key}`);

        } catch (error) {
            console.error('Error processing image:', error);
            // Don't throw - allow other images to process
        }
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Processing complete' })
    };
};

/**
 * Create watermarked version of image
 */
async function createWatermarkedImage(imageBuffer, metadata) {
    const fontSize = Math.floor(metadata.width / 15);
    const textHeight = fontSize * 1.5;
    const watermarkText = process.env.WATERMARK_TEXT || 'SNAPLI';
    const opacity = parseFloat(process.env.WATERMARK_OPACITY) || 0.3;

    const svgWatermark = `
    <svg width="${metadata.width}" height="${metadata.height}">
      <defs>
        <pattern id="watermark-pattern" x="0" y="0" width="${metadata.width / 3}" height="${textHeight * 3}" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <text x="0" y="${textHeight}" font-size="${fontSize}" font-family="Arial, sans-serif" font-weight="bold" fill="white" fill-opacity="${opacity}">
            ${watermarkText}
          </text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#watermark-pattern)"/>
    </svg>
  `;

    return await sharp(imageBuffer)
        .resize(1920, null, {
            fit: 'inside',
            withoutEnlargement: true
        })
        .composite([{
            input: Buffer.from(svgWatermark),
            gravity: 'center'
        }])
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();
}

/**
 * Create thumbnail
 */
async function createThumbnail(imageBuffer) {
    return await sharp(imageBuffer)
        .resize(300, 300, {
            fit: 'cover',
            position: 'center'
        })
        .jpeg({ quality: 80 })
        .toBuffer();
}
