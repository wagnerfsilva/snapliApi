'use strict';

// Covering indexes so dashboard/event-list aggregates are answered by index-only scans
// instead of reading the (large) photos heap. CONCURRENTLY avoids blocking uploads;
// it cannot run inside a transaction, so this migration doesn't open one.
module.exports = {
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        await sequelize.query(
            'CREATE INDEX CONCURRENTLY IF NOT EXISTS photos_processing_status_face_count ON photos ("processingStatus", "faceCount")'
        );
        await sequelize.query(
            'CREATE INDEX CONCURRENTLY IF NOT EXISTS photos_id_include_event_id ON photos (id) INCLUDE ("eventId")'
        );
    },
    async down(queryInterface) {
        const { sequelize } = queryInterface;
        await sequelize.query('DROP INDEX CONCURRENTLY IF EXISTS photos_id_include_event_id');
        await sequelize.query('DROP INDEX CONCURRENTLY IF EXISTS photos_processing_status_face_count');
    }
};
