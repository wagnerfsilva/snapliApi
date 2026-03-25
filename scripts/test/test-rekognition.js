/**
 * Script para testar Rekognition
 */

require('dotenv').config();
const { RekognitionClient, DescribeCollectionCommand } = require('@aws-sdk/client-rekognition');

const rekognitionClient = new RekognitionClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const COLLECTION_ID = process.env.REKOGNITION_COLLECTION_ID || 'snapli-faces';

async function testRekognition() {
    try {
        console.log('\n🧪 Testando Rekognition...\n');

        const command = new DescribeCollectionCommand({
            CollectionId: COLLECTION_ID
        });

        const response = await rekognitionClient.send(command);

        console.log('✅ Rekognition está funcionando!\n');
        console.log('📊 Informações da Collection:');
        console.log(`   Collection ID: ${COLLECTION_ID}`);
        console.log(`   ARN: ${response.CollectionARN}`);
        console.log(`   Faces indexadas: ${response.FaceCount}`);
        console.log(`   Versão do modelo: ${response.FaceModelVersion}`);
        console.log(`   Criada em: ${new Date(response.CreationTimestamp).toLocaleString()}\n`);

        console.log('🎉 Sistema pronto para reconhecimento facial!\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error.message);
        process.exit(1);
    }
}

testRekognition();
