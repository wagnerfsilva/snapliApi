#!/usr/bin/env node
require('dotenv').config();
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/services/email.service.js'), 'utf8');
const match = src.match(/const LOGO_PNG_BASE64 = '([A-Za-z0-9+/=]+)'/);
if (!match) { console.error('base64 não encontrado'); process.exit(1); }
const buf = Buffer.from(match[1], 'base64');

const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_WATERMARKED,
    Key: 'assets/logo.png',
    Body: buf,
    ContentType: 'image/png',
    CacheControl: 'public, max-age=31536000'
})).then(() => {
    const url = `https://${process.env.S3_BUCKET_WATERMARKED}.s3.${process.env.AWS_REGION}.amazonaws.com/assets/logo.png`;
    console.log('✅ Logo enviado com sucesso!');
    console.log('URL:', url);
}).catch(e => console.error('❌', e.message));
