'use strict';

module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.query(
            'ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "freeVideosCount" INTEGER NOT NULL DEFAULT 0'
        );
    },

    async down(queryInterface) {
        await queryInterface.sequelize.query('ALTER TABLE "events" DROP COLUMN IF EXISTS "freeVideosCount"');
    }
};
