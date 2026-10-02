'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.sequelize.transaction(async transaction => {
            const options = { transaction };
            await queryInterface.addColumn('photos', 'uploadId', { type: Sequelize.STRING, allowNull: true }, options);
            await queryInterface.addColumn('photos', 'uploadStatus', { type: Sequelize.STRING(16), allowNull: true }, options);
            await queryInterface.addColumn('photos', 'processingOwner', { type: Sequelize.UUID, allowNull: true }, options);
            await queryInterface.addColumn('photos', 'processingHeartbeatAt', { type: Sequelize.DATE, allowNull: true }, options);
            await queryInterface.addColumn('photos', 'processingAttempts', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 }, options);
            await queryInterface.addIndex('photos', ['mediaType', 'uploadStatus', 'processingStatus'], options);
        });
    },
    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async transaction => {
            await queryInterface.removeIndex('photos', ['mediaType', 'uploadStatus', 'processingStatus'], { transaction });
            for (const field of ['processingAttempts', 'processingHeartbeatAt', 'processingOwner', 'uploadStatus', 'uploadId']) {
                await queryInterface.removeColumn('photos', field, { transaction });
            }
        });
    }
};