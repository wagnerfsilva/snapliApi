'use strict';

// The Lambda callback looks photos up by originalKey; without an index each lookup
// was a sequential scan of the whole table. CONCURRENTLY avoids blocking writes and
// cannot run inside a transaction, so this migration doesn't open one.
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.query(
            'CREATE INDEX CONCURRENTLY IF NOT EXISTS photos_original_key ON photos ("originalKey")'
        );
    },
    async down(queryInterface) {
        await queryInterface.sequelize.query('DROP INDEX CONCURRENTLY IF EXISTS photos_original_key');
    }
};
