const { S3Client } = require('@aws-sdk/client-s3');
const { RekognitionClient } = require('@aws-sdk/client-rekognition');
const logger = require('../utils/logger');

// Check if AWS credentials are configured
const hasAwsCredentials = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

if (!hasAwsCredentials) {
    logger.warn('AWS credentials not configured. AWS services will not be available.');
}

const awsConfig = hasAwsCredentials ? {
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
} : {
    region: process.env.AWS_REGION || 'us-east-1'
};

// Only create clients if credentials are available
let s3Client = null;
let rekognitionClient = null;

if (hasAwsCredentials) {
    try {
        s3Client = new S3Client(awsConfig);
        rekognitionClient = new RekognitionClient(awsConfig);
        logger.info('AWS clients initialized successfully');
    } catch (error) {
        logger.error('Error initializing AWS clients:', error);
    }
}

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
    },
    isConfigured: hasAwsCredentials
};
