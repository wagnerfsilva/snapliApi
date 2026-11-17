'use strict';

module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.query(
            'ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP WITH TIME ZONE'
        );
        await queryInterface.sequelize.query(
            'CREATE INDEX IF NOT EXISTS events_archived_at ON "events" ("archivedAt")'
        );
    },

    async down(queryInterface) {
        await queryInterface.sequelize.query('DROP INDEX IF EXISTS events_archived_at');
        await queryInterface.sequelize.query('ALTER TABLE "events" DROP COLUMN IF EXISTS "archivedAt"');
    }
};
