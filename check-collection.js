require('dotenv').config();
const { rekognitionClient, rekognition } = require('./src/config/aws');
const { ListFacesCommand, DescribeCollectionCommand } = require('@aws-sdk/client-rekognition');

async function checkCollection() {
    try {
        console.log(`📋 Verificando collection: ${rekognition.collectionId}\n`);

        // Get collection info
        const describeCommand = new DescribeCollectionCommand({
            CollectionId: rekognition.collectionId
        });

        const collectionInfo = await rekognitionClient.send(describeCommand);
        console.log('✅ Collection encontrada:');
        console.log(`   ARN: ${collectionInfo.CollectionARN}`);
        console.log(`   Criada em: ${collectionInfo.CreationTimestamp}`);
        console.log(`   Total de faces: ${collectionInfo.FaceCount}`);
        console.log(`   Modelo: ${collectionInfo.FaceModelVersion}\n`);

        // List faces
        if (collectionInfo.FaceCount > 0) {
            const listCommand = new ListFacesCommand({
                CollectionId: rekognition.collectionId,
                MaxResults: 10
            });

            const facesResponse = await rekognitionClient.send(listCommand);
            console.log('👤 Primeiras 10 faces:');
            facesResponse.Faces.forEach((face, index) => {
                console.log(`   ${index + 1}. Face ID: ${face.FaceId}`);
                console.log(`      External Image ID: ${face.ExternalImageId || 'N/A'}`);
                console.log(`      Confidence: ${face.Confidence}%\n`);
            });
        } else {
            console.log('ℹ️  A collection está vazia (sem faces indexadas)');
        }

        process.exit(0);
    } catch (error) {
        if (error.name === 'ResourceNotFoundException') {
            console.log('❌ Collection não encontrada!');
            console.log(`   Collection ID: ${rekognition.collectionId}`);
            console.log('\n💡 Execute o script setup-rekognition.js para criar a collection.');
        } else {
            console.error('❌ Erro:', error.message);
        }
        process.exit(1);
    }
}

checkCollection();
