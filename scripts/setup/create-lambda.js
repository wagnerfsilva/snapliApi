/**
 * create-lambda.js — cria a função Lambda snapli-image-processor na AWS
 * Uso: node scripts/setup/create-lambda.js
 */
require('dotenv').config();
const { LambdaClient, CreateFunctionCommand, WaiterState } = require('@aws-sdk/client-lambda');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const client = new LambdaClient({
    region: process.env.AWS_REGION,
    credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
});

const ZIP_PATH = path.join(__dirname, '../../lambda/function.zip');

async function main() {
    if (!fs.existsSync(ZIP_PATH)) {
        console.error('function.zip not found. Run: cd lambda && npm install --platform=linux --arch=x64 --libc=glibc && zip -r function.zip .');
        process.exit(1);
    }

    const LAMBDA_SECRET = process.env.LAMBDA_INTERNAL_SECRET || crypto.randomBytes(32).toString('hex');
    const zip = fs.readFileSync(ZIP_PATH);

    console.log('Creating Lambda function...');
    const r = await client.send(new CreateFunctionCommand({
        FunctionName: 'snapli-image-processor',
        Runtime: 'nodejs18.x',
        Role: 'arn:aws:iam::866043232856:role/snapli-lambda-execution-role',
        Handler: 'index.handler',
        Code: { ZipFile: zip },
        Timeout: 300,
        MemorySize: 1024,
        Description: 'Snapli: watermark + thumbnail + Rekognition (callback to API)',
        Environment: {
            Variables: {
                S3_BUCKET_WATERMARKED: process.env.S3_BUCKET_WATERMARKED,
                REKOGNITION_COLLECTION_ID: process.env.REKOGNITION_COLLECTION_ID,
                WATERMARK_TEXT: process.env.WATERMARK_TEXT || 'SNAPLI',
                WATERMARK_OPACITY: process.env.WATERMARK_OPACITY || '0.4',
                API_CALLBACK_URL: process.env.API_CALLBACK_URL || 'NOT_SET',
                LAMBDA_INTERNAL_SECRET: LAMBDA_SECRET
            }
        }
    }));

    console.log('');
    console.log('Lambda CREATED');
    console.log('ARN    :', r.FunctionArn);
    console.log('State  :', r.State);
    console.log('Secret :', LAMBDA_SECRET);
    console.log('');
    if (!process.env.LAMBDA_INTERNAL_SECRET) {
        console.log('==> Adicione ao .env:');
        console.log('LAMBDA_INTERNAL_SECRET=' + LAMBDA_SECRET);
    }
}

main().catch(e => { console.error('Error:', e.name, e.message); process.exit(1); });
