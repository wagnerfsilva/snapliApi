/**
 * Script para limpar todas as fotos do evento
 */

require('dotenv').config();
const { Photo, Event } = require('./src/models');
const { s3Client } = require('./src/config/aws');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { buckets } = require('./src/config/aws');

async function deleteFromS3(key, bucket) {
    try {
        const command = new DeleteObjectCommand({
            Bucket: bucket,
            Key: key
        });
        await s3Client.send(command);
        return true;
    } catch (error) {
        console.error(`Erro ao deletar ${key}:`, error.message);
        return false;
    }
}

async function cleanupAllPhotos() {
    try {
        const eventId = '770d5bd7-df80-4bd8-853e-70b6d92418a9'; // Wagner Runs event

        console.log('\n🗑️  Limpando todas as fotos do evento...\n');

        // Buscar todas as fotos do evento
        const photos = await Photo.findAll({
            where: { eventId },
            attributes: ['id', 'originalKey', 'watermarkedKey', 'thumbnailKey', 'originalFilename']
        });

        console.log(`Encontradas ${photos.length} fotos para deletar\n`);

        if (photos.length === 0) {
            console.log('✓ Nenhuma foto encontrada\n');
            process.exit(0);
        }

        let deletedFromS3 = 0;
        let failedS3 = 0;

        console.log('Deletando arquivos do S3...');

        // Deletar arquivos do S3
        for (const photo of photos) {
            // Deletar original
            if (photo.originalKey) {
                const deleted = await deleteFromS3(photo.originalKey, buckets.original);
                if (deleted) deletedFromS3++;
                else failedS3++;
            }

            // Deletar watermarked
            if (photo.watermarkedKey) {
                const deleted = await deleteFromS3(photo.watermarkedKey, buckets.watermarked);
                if (deleted) deletedFromS3++;
                else failedS3++;
            }

            // Deletar thumbnail
            if (photo.thumbnailKey) {
                const deleted = await deleteFromS3(photo.thumbnailKey, buckets.watermarked);
                if (deleted) deletedFromS3++;
                else failedS3++;
            }
        }

        console.log(`✓ ${deletedFromS3} arquivos deletados do S3`);
        if (failedS3 > 0) {
            console.log(`⚠️  ${failedS3} arquivos falharam ao deletar`);
        }

        // Deletar registros do banco
        console.log('\nDeletando registros do banco...');
        const deleted = await Photo.destroy({
            where: { eventId }
        });

        console.log(`✓ ${deleted} registros removidos do banco\n`);

        // Resetar contador do evento
        const event = await Event.findByPk(eventId);
        await event.update({ photoCount: 0 });

        console.log('✓ Contador do evento resetado para 0\n');

        console.log('✅ Limpeza completa concluída!\n');
        console.log('📸 Sistema pronto para novo upload limpo\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
}

cleanupAllPhotos();
