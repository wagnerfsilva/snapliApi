#!/usr/bin/env node

require('dotenv').config();
const db = require('../../src/models');

const EVENT_ID = process.argv[2] || 'e414f0f9-6c57-4f74-927c-9d89843c3457';

(async () => {
  try {
    console.log(`\nBuscando fotógrafos para o evento: ${EVENT_ID}\n`);

    const photos = await db.Photo.findAll({
      where: { eventId: EVENT_ID },
      attributes: ['uploadedBy'],
      raw: true,
      subQuery: false
    });

    const uniquePhotographers = [...new Set(photos.map(p => p.uploadedBy))];

    if (uniquePhotographers.length === 0) {
      console.log('✗ Nenhum fotógrafo enviou fotos para este evento.');
      process.exit(0);
    }

    const photographers = await db.User.findAll({
      where: { id: uniquePhotographers },
      attributes: ['id', 'name', 'email'],
      raw: true
    });

    console.log(`✓ Total de fotógrafos: ${photographers.length}\n`);
    console.log('---\n');
    photographers.forEach((p, i) => {
      const photoCount = photos.filter(ph => ph.uploadedBy === p.id).length;
      console.log(`${i + 1}. ${p.name}`);
      console.log(`   📧 ${p.email}`);
      console.log(`   📸 Fotos: ${photoCount}\n`);
    });

  } catch (error) {
    console.error('Erro:', error.message);
    process.exit(1);
  } finally {
    await db.sequelize.close();
  }
})();
