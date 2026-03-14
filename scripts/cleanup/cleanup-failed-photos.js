/**
 * Script para limpar fotos com erro do banco de dados
 */

require('dotenv').config();
const { Photo, Event } = require('../src/models');

async function cleanupFailedPhotos() {
    try {
        const eventId = '770d5bd7-df80-4bd8-853e-70b6d92418a9'; // Wagner Runs event

        console.log('\n🧹 Limpando fotos com erro...\n');

        // Buscar fotos com erro ou sem chaves S3
        const failedPhotos = await Photo.findAll({
            where: {
                eventId,
                processingStatus: ['failed', 'pending']
            }
        });

        console.log(`Encontradas ${failedPhotos.length} fotos com erro/pendentes`);

        // Filtrar fotos que realmente não têm arquivos no S3
        const photosToDelete = failedPhotos.filter(photo => {
            // Se não tem originalKey ou watermarkedKey, não foi realmente enviada
            return !photo.originalKey || !photo.watermarkedKey;
        });

        console.log(`${photosToDelete.length} fotos sem arquivos no S3 serão removidas\n`);

        if (photosToDelete.length > 0) {
            // Deletar fotos sem arquivos
            const idsToDelete = photosToDelete.map(p => p.id);

            const deleted = await Photo.destroy({
                where: {
                    id: idsToDelete
                }
            });

            console.log(`✓ ${deleted} registros removidos do banco\n`);

            // Atualizar contador do evento
            const event = await Event.findByPk(eventId);
            const actualPhotos = await Photo.count({ where: { eventId } });

            await event.update({ photoCount: actualPhotos });

            console.log(`✓ Contador atualizado: ${actualPhotos} fotos no evento\n`);
        }

        // Mostrar estatísticas finais
        const stats = await Photo.findAll({
            where: { eventId },
            attributes: [
                'processingStatus',
                [require('sequelize').fn('COUNT', 'id'), 'count']
            ],
            group: ['processingStatus'],
            raw: true
        });

        console.log('📊 Status Final:');
        stats.forEach(stat => {
            console.log(`   ${stat.processingStatus}: ${stat.count}`);
        });

        const total = await Photo.count({ where: { eventId } });
        console.log(`   Total: ${total}\n`);

        console.log('✅ Limpeza concluída!\n');
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
}

cleanupFailedPhotos();
