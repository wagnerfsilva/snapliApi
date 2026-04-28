/**
 * update-lambda.js — atualiza o código da Lambda snapli-image-processor
 * Uso: node scripts/setup/update-lambda.js
 */
require('dotenv').config();
const { LambdaClient, UpdateFunctionCodeCommand } = require('@aws-sdk/client-lambda');
const fs = require('fs');
const path = require('path');

const ZIP_PATH = path.join(__dirname, '../../lambda/function.zip');

const client = new LambdaClient({
    region: process.env.AWS_REGION,
    credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
});

async function main() {
    const zip = fs.readFileSync(ZIP_PATH);
    console.log(`Uploading ${(zip.length / 1024 / 1024).toFixed(1)} MB to snapli-image-processor...`);
    const r = await client.send(new UpdateFunctionCodeCommand({
        FunctionName: 'snapli-image-processor',
        ZipFile: zip
    }));
    console.log('Done.');
    console.log('State    :', r.State);
    console.log('CodeSize :', r.CodeSize, 'bytes');
    console.log('Updated  :', r.LastModified);
}

main().catch(e => { console.error('Error:', e.name, e.message); process.exit(1); });
