require('dotenv').config();
const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3');
const { RekognitionClient, ListCollectionsCommand } = require('@aws-sdk/client-rekognition');

console.log('🔍 Testando credenciais AWS...\n');

const awsConfig = {
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
};

const s3Client = new S3Client(awsConfig);
const rekognitionClient = new RekognitionClient(awsConfig);

async function testAWS() {
    try {
        console.log('📡 Testando credenciais AWS...');
        console.log(`   Region: ${process.env.AWS_REGION}`);
        console.log(`   Access Key: ${process.env.AWS_ACCESS_KEY_ID}\n`);

        // Testar S3
        console.log('📦 Testando acesso ao S3...');
        const s3Command = new ListBucketsCommand({});
        const s3Response = await s3Client.send(s3Command);
        
        console.log('✅ S3: Conexão estabelecida com sucesso!');
        
        if (s3Response.Buckets && s3Response.Buckets.length > 0) {
            console.log('\n📋 Buckets S3 disponíveis:');
            s3Response.Buckets.forEach(bucket => {
                console.log(`   - ${bucket.Name}`);
            });
            
            // Verificar se os buckets necessários existem
            const bucketNames = s3Response.Buckets.map(b => b.Name);
            const hasOriginal = bucketNames.some(name => name.includes('original'));
            const hasWatermarked = bucketNames.some(name => name.includes('watermark'));
            
            if (hasOriginal) {
                console.log('\n✅ Bucket de originais encontrado!');
            } else {
                console.log('\n⚠️  Bucket de originais não encontrado. Você precisará criar um bucket para fotos originais.');
            }
            
            if (hasWatermarked) {
                console.log('✅ Bucket de marca d\'água encontrado!');
            } else {
                console.log('⚠️  Bucket de marca d\'água não encontrado. Você precisará criar um bucket para fotos com marca d\'água.');
            }
        } else {
            console.log('\n⚠️  Nenhum bucket S3 encontrado. Você precisará criar os buckets.');
        }

        // Testar Rekognition
        console.log('\n\n🤖 Testando acesso ao Rekognition...');
        const rekCommand = new ListCollectionsCommand({});
        const rekResponse = await rekognitionClient.send(rekCommand);
        
        console.log('✅ Rekognition: Conexão estabelecida com sucesso!');
        
        if (rekResponse.CollectionIds && rekResponse.CollectionIds.length > 0) {
            console.log('\n📋 Coleções Rekognition disponíveis:');
            rekResponse.CollectionIds.forEach(collectionId => {
                console.log(`   - ${collectionId}`);
            });
            
            if (rekResponse.CollectionIds.includes('fotow-faces')) {
                console.log('\n✅ Coleção "fotow-faces" encontrada!');
            } else {
                console.log('\n⚠️  Coleção "fotow-faces" não encontrada. Você precisará criar a coleção.');
            }
        } else {
            console.log('\n⚠️  Nenhuma coleção Rekognition encontrada. Você precisará criar a coleção "fotow-faces".');
        }

        console.log('\n\n✅ Teste de credenciais AWS concluído com sucesso!');
        console.log('\n📝 Resumo:');
        console.log('   ✅ Credenciais AWS válidas e funcionando');
        console.log('   ✅ Acesso ao S3 confirmado');
        console.log('   ✅ Acesso ao Rekognition confirmado');
        
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ ERRO ao testar AWS:\n');
        console.error(`   ${error.message}\n`);
        
        if (error.message.includes('InvalidAccessKeyId')) {
            console.error('💡 Dica: O Access Key ID está incorreto.');
        } else if (error.message.includes('SignatureDoesNotMatch')) {
            console.error('💡 Dica: O Secret Access Key está incorreto.');
        } else if (error.message.includes('AccessDenied')) {
            console.error('💡 Dica: As credenciais não têm permissão para acessar o serviço.');
        } else if (error.message.includes('UnrecognizedClientException')) {
            console.error('💡 Dica: A região AWS pode estar incorreta.');
        }
        
        process.exit(1);
    }
}

testAWS();
