'use strict';

const { CopyObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, buckets, rekognition } = require('../config/aws');

function isReady() {
    return Boolean(process.env.VIDEO_LAMBDA_ENABLED === 'true' && s3Client && buckets.original && buckets.watermarked && rekognition.collectionId && process.env.LAMBDA_INTERNAL_SECRET);
}

async function retry(photo) {
    if (!isReady()) throw new Error('Lambda de video nao configurada');
    await s3Client.send(new CopyObjectCommand({
        Bucket: buckets.original, Key: photo.originalKey,
        CopySource: `${buckets.original}/${photo.originalKey.split('/').map(encodeURIComponent).join('/')}`,
        MetadataDirective: 'COPY', ServerSideEncryption: 'AES256'
    }));
}

module.exports = { isReady, retry };