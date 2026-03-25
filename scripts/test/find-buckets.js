require('dotenv').config();
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

console.log('🔍 Testando buckets S3 com nomes alternativos...\n');

const possibleNames = [
    'snapli-originals',
    'snapli-watermarked',
    'snapli-original',
    'snapli-watermark',
    'snapli-photos-original',
    'snapli-photos-watermarked',
    'snapli-app-originals',
    'snapli-app-watermarked'
];

async function testBuckets() {
    console.log('📦 Testando possíveis nomes de buckets...\n');
    
    for (const bucketName of possibleNames) {
        try {
            await s3Client.send(new ListObjectsV2Command({ 
                Bucket: bucketName,
                MaxKeys: 1
            }));
            console.log(`✅ Encontrado: ${bucketName}`);
        } catch (error) {
            console.log(`❌ Não existe: ${bucketName}`);
        }
    }
    
    console.log('\n💡 Se nenhum bucket foi encontrado, você precisa me informar os nomes corretos dos buckets S3.');
    console.log('   Ou podemos criar novos buckets se necessário.\n');
}

testBuckets();
