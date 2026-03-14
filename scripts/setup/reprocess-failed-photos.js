/**
 * Script para reprocessar fotos com falha no reconhecimento facial
 */

require('dotenv').config();
const { Photo } = require('../src/models');
const PhotoController = require('../src/controllers/photo.controller');

async function reprocessFailedPhotos() {
    try {
        const eventId = '770d5bd7-df80-4bd8-853e-70b6d92418a9';

        console.log('\n🔄 Iniciando reprocessamento de fotos...\n');

        // Buscar fotos com falha
        const failedPhotos = await Photo.findAll({
            where: {
                eventId,
                processingStatus: 'failed'
            }
        });

        console.log(`Encontradas ${failedPhotos.length} fotos com falha\n`);

        if (failedPhotos.length === 0) {
            console.log('✓ Nenhuma foto precisa ser reprocessada\n');
            process.exit(0);
        }

        // Marcar como pendente para reprocessamento
        console.log('Marcando fotos como pendentes...');
        await Photo.update(
            { processingStatus: 'pending', processingError: null },
            { where: { eventId, processingStatus: 'failed' } }
        );

        console.log(`✓ ${failedPhotos.length} fotos marcadas como pendentes\n`);
        console.log('⚠️  As fotos serão reprocessadas em background pelo sistema\n');
        console.log('Recarregue a página do evento para ver o status atualizado\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
}

reprocessFailedPhotos();
