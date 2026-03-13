require('dotenv').config();
const { s3Client, rekognitionClient, buckets, rekognition } = require('./src/config/aws');
const {
    ListObjectsV2Command,
    DeleteObjectsCommand,
    DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const {
    DeleteFacesCommand,
    ListFacesCommand
} = require('@aws-sdk/client-rekognition');

async function emptyS3Bucket(bucketName) {
    try {
        console.log(`🗑️  Limpando bucket: ${bucketName}...`);

        let isTruncated = true;
        let continuationToken = undefined;
        let totalDeleted = 0;

        while (isTruncated) {
            const listParams = {
                Bucket: bucketName,
                ContinuationToken: continuationToken
            };

            const listCommand = new ListObjectsV2Command(listParams);
            const listResponse = await s3Client.send(listCommand);

            if (listResponse.Contents && listResponse.Contents.length > 0) {
                const deleteParams = {
                    Bucket: bucketName,
                    Delete: {
                        Objects: listResponse.Contents.map(({ Key }) => ({ Key })),
                        Quiet: false
                    }
                };

                const deleteCommand = new DeleteObjectsCommand(deleteParams);
                const deleteResponse = await s3Client.send(deleteCommand);

                totalDeleted += deleteResponse.Deleted?.length || 0;
                console.log(`   Deletados ${deleteResponse.Deleted?.length || 0} objetos`);
            }

            isTruncated = listResponse.IsTruncated;
            continuationToken = listResponse.NextContinuationToken;
        }

        console.log(`✅ Bucket ${bucketName} limpo! Total: ${totalDeleted} objetos removidos\n`);
        return totalDeleted;
    } catch (error) {
        console.error(`❌ Erro ao limpar bucket ${bucketName}:`, error.message);
        return 0;
    }
}

async function cleanRekognitionCollection() {
    try {
        console.log(`🧹 Limpando collection Rekognition: ${rekognition.collectionId}...`);

        const listCommand = new ListFacesCommand({
            CollectionId: rekognition.collectionId,
            MaxResults: 4096
        });

        const listResponse = await rekognitionClient.send(listCommand);

        if (listResponse.Faces && listResponse.Faces.length > 0) {
            const faceIds = listResponse.Faces.map(face => face.FaceId);

            const deleteCommand = new DeleteFacesCommand({
                CollectionId: rekognition.collectionId,
                FaceIds: faceIds
            });

            const deleteResponse = await rekognitionClient.send(deleteCommand);
            console.log(`✅ Removidas ${deleteResponse.DeletedFaces?.length || 0} faces da collection\n`);
            return deleteResponse.DeletedFaces?.length || 0;
        } else {
            console.log(`✅ Collection já está vazia\n`);
            return 0;
        }
    } catch (error) {
        console.error(`❌ Erro ao limpar collection Rekognition:`, error.message);
        return 0;
    }
}

async function cleanupS3() {
    try {
        console.log('🧹 Iniciando limpeza do S3...\n');

        // Clean buckets
        const originalDeleted = await emptyS3Bucket(buckets.original);
        const watermarkedDeleted = await emptyS3Bucket(buckets.watermarked);

        // Clean Rekognition collection
        const facesDeleted = await cleanRekognitionCollection();

        console.log('📊 Resumo da limpeza:');
        console.log(`   Bucket Original: ${originalDeleted} objetos`);
        console.log(`   Bucket Watermarked: ${watermarkedDeleted} objetos`);
        console.log(`   Faces Rekognition: ${facesDeleted} faces`);
        console.log('\n✅ Limpeza do S3 concluída!');

        process.exit(0);
    } catch (error) {
        console.error('❌ Erro ao limpar S3:', error);
        process.exit(1);
    }
}

cleanupS3();
