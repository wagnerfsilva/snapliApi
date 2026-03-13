const { S3Client } = require('@aws-sdk/client-s3');
const { RekognitionClient } = require('@aws-sdk/client-rekognition');

const awsConfig = {
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
};

const s3Client = new S3Client(awsConfig);
const rekognitionClient = new RekognitionClient(awsConfig);

module.exports = {
    s3Client,
    rekognitionClient,
    buckets: {
        original: process.env.S3_BUCKET_ORIGINAL,
        watermarked: process.env.S3_BUCKET_WATERMARKED
    },
    rekognition: {
        collectionId: process.env.REKOGNITION_COLLECTION_ID,
        similarityThreshold: parseFloat(process.env.REKOGNITION_SIMILARITY_THRESHOLD) || 80
    }
};
