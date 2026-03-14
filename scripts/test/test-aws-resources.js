require('dotenv').config();
const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { RekognitionClient, DescribeCollectionCommand } = require('@aws-sdk/client-rekognition');

console.log('🔍 Testando acesso aos recursos AWS específicos...\n');

const awsConfig = {
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
};

const s3Client = new S3Client(awsConfig);
const rekognitionClient = new RekognitionClient(awsConfig);

async function testAWSResources() {
    let hasErrors = false;
    
    try {
        console.log('📡 Credenciais AWS:');
        console.log(`   Region: ${process.env.AWS_REGION}`);
        console.log(`   Access Key: ${process.env.AWS_ACCESS_KEY_ID}\n`);

        // Testar Bucket Original
        console.log('📦 Testando acesso ao bucket de originais...');
        console.log(`   Bucket: ${process.env.S3_BUCKET_ORIGINAL}`);
        try {
            await s3Client.send(new HeadBucketCommand({ 
                Bucket: process.env.S3_BUCKET_ORIGINAL 
            }));
            console.log('   ✅ Acesso confirmado!\n');
        } catch (error) {
            console.log(`   ❌ Erro: ${error.message}\n`);
            hasErrors = true;
        }

        // Testar Bucket Watermarked
        console.log('📦 Testando acesso ao bucket de marca d\'água...');
        console.log(`   Bucket: ${process.env.S3_BUCKET_WATERMARKED}`);
        try {
            await s3Client.send(new HeadBucketCommand({ 
                Bucket: process.env.S3_BUCKET_WATERMARKED 
            }));
            console.log('   ✅ Acesso confirmado!\n');
        } catch (error) {
            console.log(`   ❌ Erro: ${error.message}\n`);
            hasErrors = true;
        }

        // Testar Coleção Rekognition
        console.log('🤖 Testando acesso à coleção Rekognition...');
        console.log(`   Coleção: ${process.env.REKOGNITION_COLLECTION_ID}`);
        try {
            const response = await rekognitionClient.send(new DescribeCollectionCommand({ 
                CollectionId: process.env.REKOGNITION_COLLECTION_ID 
            }));
            console.log('   ✅ Coleção encontrada!');
            console.log(`   📊 Faces indexadas: ${response.FaceCount || 0}`);
            console.log(`   🆔 Collection ARN: ${response.CollectionARN}\n`);
        } catch (error) {
            if (error.name === 'ResourceNotFoundException') {
                console.log('   ⚠️  Coleção não existe. Precisa ser criada.\n');
                hasErrors = true;
            } else {
                console.log(`   ❌ Erro: ${error.message}\n`);
                hasErrors = true;
            }
        }

        if (!hasErrors) {
            console.log('✅ SUCESSO! Todos os recursos AWS estão acessíveis e configurados!\n');
            console.log('📝 Resumo:');
            console.log(`   ✅ Bucket Original: ${process.env.S3_BUCKET_ORIGINAL}`);
            console.log(`   ✅ Bucket Watermarked: ${process.env.S3_BUCKET_WATERMARKED}`);
            console.log(`   ✅ Coleção Rekognition: ${process.env.REKOGNITION_COLLECTION_ID}`);
            process.exit(0);
        } else {
            console.log('⚠️  Alguns recursos precisam de atenção. Veja os erros acima.\n');
            process.exit(1);
        }
        
    } catch (error) {
        console.error('\n❌ ERRO geral:\n');
        console.error(`   ${error.message}\n`);
        
        if (error.message.includes('InvalidAccessKeyId')) {
            console.error('💡 Dica: O Access Key ID está incorreto.');
        } else if (error.message.includes('SignatureDoesNotMatch')) {
            console.error('💡 Dica: O Secret Access Key está incorreto.');
        }
        
        process.exit(1);
    }
}

testAWSResources();
