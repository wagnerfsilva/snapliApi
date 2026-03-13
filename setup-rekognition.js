/**
 * Script para configurar AWS Rekognition
 */

require('dotenv').config();
const { RekognitionClient, CreateCollectionCommand, DescribeCollectionCommand, ListCollectionsCommand } = require('@aws-sdk/client-rekognition');

const rekognitionClient = new RekognitionClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const COLLECTION_ID = process.env.REKOGNITION_COLLECTION_ID || 'fotow-faces';

async function setupRekognition() {
    try {
        console.log('\n🎭 Configurando AWS Rekognition...\n');
        console.log(`Region: ${process.env.AWS_REGION}`);
        console.log(`Collection ID: ${COLLECTION_ID}\n`);

        // Verificar se a collection já existe
        console.log('Verificando se a collection já existe...');

        try {
            const describeCommand = new DescribeCollectionCommand({
                CollectionId: COLLECTION_ID
            });
            const response = await rekognitionClient.send(describeCommand);

            console.log('✅ Collection já existe!\n');
            console.log(`   Collection ARN: ${response.CollectionARN}`);
            console.log(`   Faces indexadas: ${response.FaceCount}`);
            console.log(`   Criada em: ${new Date(response.CreationTimestamp).toLocaleString()}\n`);

            console.log('🎉 Rekognition está pronto para uso!\n');
            return;

        } catch (error) {
            if (error.name === 'ResourceNotFoundException') {
                console.log('Collection não existe. Criando...\n');
            } else {
                throw error;
            }
        }

        // Criar a collection
        console.log(`Criando collection: ${COLLECTION_ID}...`);

        const createCommand = new CreateCollectionCommand({
            CollectionId: COLLECTION_ID
        });

        const createResponse = await rekognitionClient.send(createCommand);

        console.log('✅ Collection criada com sucesso!\n');
        console.log(`   Collection ARN: ${createResponse.CollectionArn}`);
        console.log(`   Status Code: ${createResponse.StatusCode}\n`);

        // Listar todas as collections
        console.log('Collections disponíveis:');
        const listCommand = new ListCollectionsCommand({});
        const listResponse = await rekognitionClient.send(listCommand);

        listResponse.CollectionIds.forEach(id => {
            console.log(`   - ${id}`);
        });

        console.log('\n🎉 Rekognition configurado com sucesso!\n');
        console.log('📋 Próximos passos:');
        console.log('   1. Faça upload de fotos do evento');
        console.log('   2. As faces serão indexadas automaticamente');
        console.log('   3. Use a busca facial para encontrar fotos\n');

    } catch (error) {
        console.error('\n❌ Erro ao configurar Rekognition:', error.message);

        if (error.name === 'AccessDeniedException') {
            console.error('\n⚠️  Problema de permissão!');
            console.error('Certifique-se que o usuário IAM tem as permissões:');
            console.error('   - rekognition:CreateCollection');
            console.error('   - rekognition:DescribeCollection');
            console.error('   - rekognition:ListCollections\n');
        }

        process.exit(1);
    }
}

setupRekognition();
