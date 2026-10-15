'use strict';

const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const os = require('node:os');
const path = require('node:path');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { RekognitionClient, IndexFacesCommand } = require('@aws-sdk/client-rekognition');
const { prepareVideo } = require('../../src/services/video-processing.service');

const s3 = new S3Client({ region: process.env.AWS_REGION });
const rekognition = new RekognitionClient({ region: process.env.AWS_REGION });

async function callback(payload) {
    if (!process.env.API_CALLBACK_URL || !process.env.LAMBDA_INTERNAL_SECRET) throw new Error('Callback de video nao configurado');
    const response = await fetch(process.env.API_CALLBACK_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lambda-secret': process.env.LAMBDA_INTERNAL_SECRET },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`Callback de video retornou ${response.status}`);
    return response.json();
}

async function put(filePath, key, contentType) {
    const stat = await fs.stat(filePath);
    await s3.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_WATERMARKED, Key: key, Body: createReadStream(filePath), ContentLength: stat.size,
        ContentType: contentType, ServerSideEncryption: 'AES256', CacheControl: 'max-age=3600'
    }));
}

exports.handler = async (event, context) => {
    for (const record of event.Records || []) {
        const originalKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        const bucket = record.s3.bucket.name;
        if (bucket !== process.env.S3_BUCKET_ORIGINAL || !/^events\/[\w-]+\/videos\/[\w-]+\/original\.(mov|mp4)$/i.test(originalKey)) continue;
        const owner = context.awsRequestId;
        const claim = await callback({ action: 'claim', originalKey, owner });
        if (!claim.data?.claimed) continue;
        const { id, eventId, processingVersion, fileSize } = claim.data;
        let sourceDirectory;
        let prepared;
        try {
            sourceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'snapli-video-source-'));
            const source = path.join(sourceDirectory, path.basename(originalKey));
            const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: originalKey }), { abortSignal: AbortSignal.timeout(120000) });
            await pipeline(response.Body, createWriteStream(source));
            if ((await fs.stat(source)).size !== fileSize) throw new Error('Original incompleto no S3');
            prepared = await prepareVideo(source);
            const prefix = `events/${eventId}/videos/${id}/v${processingVersion}`;
            const previewKey = `${prefix}/preview.mp4`;
            const thumbnailKey = `${prefix}/poster.jpg`;
            await put(prepared.previewPath, previewKey, 'video/mp4');
            await put(prepared.posterPath, thumbnailKey, 'image/jpeg');
            let faceCount = 0;
            for (const frame of prepared.frames) {
                if (context.getRemainingTimeInMillis() < 45000) throw new Error('Lambda sem tempo suficiente para concluir');
                const result = await rekognition.send(new IndexFacesCommand({
                    CollectionId: process.env.REKOGNITION_COLLECTION_ID,
                    Image: { Bytes: await fs.readFile(frame.filePath) },
                    ExternalImageId: `video_${id}_v${processingVersion}_t${frame.timestampMs}`,
                    MaxFaces: 100, QualityFilter: 'AUTO', DetectionAttributes: ['ALL']
                }));
                const faces = (result.FaceRecords || []).map(record => ({
                    faceId: record.Face.FaceId, confidence: record.Face.Confidence,
                    boundingBox: record.Face.BoundingBox, timestampMs: frame.timestampMs
                }));
                await callback({ action: 'faces', originalKey, owner, processingVersion, faces });
                faceCount += faces.length;
            }
            await callback({ action: 'completed', originalKey, owner, processingVersion, previewKey, thumbnailKey,
                metadata: prepared.metadata, sampleRate: prepared.sampleRate, faceCount });
        } catch (error) {
            await callback({ action: 'failed', originalKey, owner, processingVersion, processingError: error.message })
                .catch(callbackError => console.error('Video failure callback:', callbackError.message));
            throw error;
        } finally {
            if (prepared) await fs.rm(prepared.directory, { recursive: true, force: true });
            if (sourceDirectory) await fs.rm(sourceDirectory, { recursive: true, force: true });
        }
    }
};