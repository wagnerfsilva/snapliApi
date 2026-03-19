require('dotenv').config();
const { Photo, Event, Order, OrderItem } = require('../../src/models');
const { s3Client, buckets, rekognitionClient, rekognition } = require('../../src/config/aws');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { DeleteFacesCommand } = require('@aws-sdk/client-rekognition');
const { Op } = require('sequelize');

const EVENT_ID = '06fb59f7-fb7c-48c9-ae4d-6b9c443e7108';

async function deleteFromS3(key, bucket) {
    try {
        await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        return true;
    } catch (e) { console.error('  S3 erro:', key, e.message); return false; }
}

async function run() {
    console.log('Buscando fotos do evento', EVENT_ID, '...');
    const photos = await Photo.findAll({
        where: { eventId: EVENT_ID },
        attributes: ['id', 'originalKey', 'watermarkedKey', 'thumbnailKey', 'rekognitionFaceId', 'originalFilename']
    });
    console.log('Encontradas:', photos.length, 'fotos\n');

    if (photos.length === 0) { console.log('Nada a limpar.'); process.exit(0); }

    // 1. Rekognition - deletar faces
    const faceIds = photos.map(p => p.rekognitionFaceId).filter(Boolean);
    if (faceIds.length > 0) {
        console.log('1. Deletando', faceIds.length, 'faces do Rekognition...');
        try {
            const resp = await rekognitionClient.send(new DeleteFacesCommand({
                CollectionId: rekognition.collectionId,
                FaceIds: faceIds
            }));
            console.log('   Deletadas:', resp.DeletedFaces?.length || 0, 'faces');
        } catch (e) { console.error('   Rekognition erro:', e.message); }
    } else {
        console.log('1. Nenhuma face indexada no Rekognition');
    }

    // 2. S3 - deletar arquivos
    console.log('\n2. Deletando arquivos do S3...');
    let s3ok = 0, s3fail = 0;
    for (const p of photos) {
        if (p.originalKey) { (await deleteFromS3(p.originalKey, buckets.original)) ? s3ok++ : s3fail++; }
        if (p.watermarkedKey) { (await deleteFromS3(p.watermarkedKey, buckets.watermarked)) ? s3ok++ : s3fail++; }
        if (p.thumbnailKey) { (await deleteFromS3(p.thumbnailKey, buckets.watermarked)) ? s3ok++ : s3fail++; }
    }
    console.log('   S3 deletados:', s3ok, '| falhas:', s3fail);

    // 3. Banco - deletar order_items, orders e photos (respeitando FKs)
    console.log('\n3. Deletando registros do banco...');
    
    const photoIds = photos.map(p => p.id);

    // 3a. Deletar order_items que referenciam essas fotos
    const deletedItems = await OrderItem.destroy({ where: { photoId: { [Op.in]: photoIds } } });
    console.log('   Order items removidos:', deletedItems);

    // 3b. Deletar orders órfãs do evento (orders sem items restantes)
    const orders = await Order.findAll({
        where: { '$items.id$': null },
        include: [{ model: OrderItem, as: 'items', required: false }]
    });
    const orphanOrderIds = orders.map(o => o.id);
    if (orphanOrderIds.length > 0) {
        const deletedOrders = await Order.destroy({ where: { id: { [Op.in]: orphanOrderIds } } });
        console.log('   Orders órfãs removidas:', deletedOrders);
    }

    // 3c. Deletar fotos
    const deleted = await Photo.destroy({ where: { eventId: EVENT_ID } });
    console.log('   Fotos removidas:', deleted);

    // 4. Resetar photoCount do evento
    const event = await Event.findByPk(EVENT_ID);
    if (event) {
        await event.update({ photoCount: 0 });
        console.log('   photoCount resetado para 0');
    }

    console.log('\nLimpeza completa!');
    process.exit(0);
}
run().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
