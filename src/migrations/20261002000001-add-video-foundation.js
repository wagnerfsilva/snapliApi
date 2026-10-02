'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.sequelize.transaction(async transaction => {
            const options = { transaction };
            await queryInterface.addColumn('photos', 'mediaType', {
                type: Sequelize.STRING(10), allowNull: false, defaultValue: 'photo'
            }, options);
            await queryInterface.addConstraint('photos', {
                fields: ['mediaType'], type: 'check', name: 'photos_media_type_check',
                where: { mediaType: { [Sequelize.Op.in]: ['photo', 'video'] } }, transaction
            });
            await queryInterface.addColumn('photos', 'durationMs', { type: Sequelize.INTEGER, allowNull: true }, options);
            await queryInterface.addColumn('photos', 'previewKey', { type: Sequelize.STRING, allowNull: true }, options);
            await queryInterface.addColumn('photos', 'processingVersion', {
                type: Sequelize.INTEGER, allowNull: false, defaultValue: 1
            }, options);
            await queryInterface.addColumn('events', 'videoEnabled', {
                type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false
            }, options);
            await queryInterface.addColumn('events', 'videoCount', {
                type: Sequelize.INTEGER, allowNull: false, defaultValue: 0
            }, options);
            await queryInterface.addColumn('events', 'pricePerVideo', { type: Sequelize.DECIMAL(10, 2), allowNull: true }, options);
            await queryInterface.addColumn('events', 'videoPricingPackages', { type: Sequelize.JSON, allowNull: true }, options);
            await queryInterface.addColumn('events', 'allVideosPrice', { type: Sequelize.DECIMAL(10, 2), allowNull: true }, options);
            await queryInterface.createTable('media_faces', {
                faceId: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
                collectionId: { type: Sequelize.STRING, allowNull: false },
                photoId: {
                    type: Sequelize.UUID, allowNull: false,
                    references: { model: 'photos', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE'
                },
                timestampMs: { type: Sequelize.INTEGER, allowNull: false },
                processingVersion: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
                confidence: { type: Sequelize.FLOAT, allowNull: true },
                boundingBox: { type: Sequelize.JSONB, allowNull: true }
            }, options);
            await queryInterface.addIndex('media_faces', ['photoId', 'processingVersion'], options);
            await queryInterface.addIndex('media_faces', ['collectionId'], options);
            await queryInterface.sequelize.query('ALTER TABLE media_faces ENABLE ROW LEVEL SECURITY', options);
            await queryInterface.sequelize.query(
                'CREATE POLICY block_public_access ON media_faces AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false)',
                options
            );
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async transaction => {
            const options = { transaction };
            await queryInterface.dropTable('media_faces', options);
            await queryInterface.removeConstraint('photos', 'photos_media_type_check', options);
            for (const column of ['processingVersion', 'previewKey', 'durationMs', 'mediaType']) {
                await queryInterface.removeColumn('photos', column, options);
            }
            for (const column of ['allVideosPrice', 'videoPricingPackages', 'pricePerVideo', 'videoCount', 'videoEnabled']) {
                await queryInterface.removeColumn('events', column, options);
            }
        });
    }
};