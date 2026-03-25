require('dotenv').config();
const { Sequelize } = require('sequelize');

const EVENT_ID = '06fb59f7-fb7c-48c9-ae4d-6b9c443e7108';

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'postgres',
    logging: false
});

async function check() {
    // Check photos
    const [photos] = await sequelize.query(
        `SELECT id, "originalKey", "watermarkedKey", "processingStatus", "rekognitionFaceId" FROM photos WHERE "eventId" = '${EVENT_ID}'`
    );
    console.log('Total fotos:', photos.length);
    if (photos.length > 0) {
        console.log('\nExemplo:', JSON.stringify(photos[0], null, 2));
        console.log('\nStatus breakdown:');
        const statuses = {};
        photos.forEach(p => { statuses[p.processingStatus] = (statuses[p.processingStatus] || 0) + 1; });
        console.log(statuses);

        // Check S3 keys - are they pointing to old fotow buckets?
        const photoKeys = photos.map(p => p.originalKey).filter(Boolean);
        console.log('\nExemplos de originalKey:');
        photoKeys.slice(0, 3).forEach(k => console.log(' ', k));
    }

    // Check order items referencing these photos
    const [orderItems] = await sequelize.query(
        `SELECT oi.id, oi."photoId", oi."orderId" FROM "orderItems" oi INNER JOIN photos p ON oi."photoId" = p.id WHERE p."eventId" = '${EVENT_ID}'`
    );
    console.log('\nOrder items vinculados:', orderItems.length);
    if (orderItems.length > 0) {
        console.log('Exemplos:', JSON.stringify(orderItems.slice(0, 3), null, 2));
    }

    // Check event
    const [events] = await sequelize.query(
        `SELECT id, name, "photoCount" FROM events WHERE id = '${EVENT_ID}'`
    );
    if (events.length > 0) {
        console.log('\nEvento:', JSON.stringify(events[0], null, 2));
    } else {
        console.log('\nEvento NAO encontrado!');
    }

    // Check foreign key constraints on photos table
    const [constraints] = await sequelize.query(`
        SELECT tc.constraint_name, tc.constraint_type, kcu.column_name, 
               ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
        LEFT JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'photos' OR (ccu.table_name = 'photos' AND tc.constraint_type = 'FOREIGN KEY')
    `);
    console.log('\nConstraints na tabela photos:');
    constraints.forEach(c => console.log(`  ${c.constraint_type}: ${c.constraint_name} (${c.column_name} -> ${c.foreign_table_name}.${c.foreign_column_name})`));

    // Check if orderItems has FK constraint referencing photos
    const [oiConstraints] = await sequelize.query(`
        SELECT tc.constraint_name, tc.constraint_type, kcu.column_name,
               ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name,
               rc.delete_rule
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
        LEFT JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
        LEFT JOIN information_schema.referential_constraints AS rc ON rc.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'orderItems' AND tc.constraint_type = 'FOREIGN KEY'
    `);
    console.log('\nConstraints na tabela orderItems:');
    oiConstraints.forEach(c => console.log(`  ${c.constraint_name}: ${c.column_name} -> ${c.foreign_table_name}.${c.foreign_column_name} (ON DELETE: ${c.delete_rule})`));

    await sequelize.close();
}

check().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
