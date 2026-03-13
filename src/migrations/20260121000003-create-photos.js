'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('photos', {
            id: {
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4,
                primaryKey: true
            },
            eventId: {
                type: Sequelize.UUID,
                allowNull: false,
                references: {
                    model: 'events',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            originalFilename: {
                type: Sequelize.STRING,
                allowNull: false
            },
            originalKey: {
                type: Sequelize.STRING,
                allowNull: false
            },
            watermarkedKey: {
                type: Sequelize.STRING,
                allowNull: false
            },
            thumbnailKey: {
                type: Sequelize.STRING,
                allowNull: true
            },
            width: {
                type: Sequelize.INTEGER,
                allowNull: true
            },
            height: {
                type: Sequelize.INTEGER,
                allowNull: true
            },
            fileSize: {
                type: Sequelize.INTEGER,
                allowNull: true
            },
            mimeType: {
                type: Sequelize.STRING,
                allowNull: true
            },
            faceData: {
                type: Sequelize.JSONB,
                allowNull: true
            },
            faceCount: {
                type: Sequelize.INTEGER,
                defaultValue: 0
            },
            rekognitionFaceId: {
                type: Sequelize.STRING,
                allowNull: true
            },
            metadata: {
                type: Sequelize.JSONB,
                allowNull: true
            },
            processingStatus: {
                type: Sequelize.ENUM('pending', 'processing', 'completed', 'failed'),
                defaultValue: 'pending'
            },
            processingError: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            uploadedBy: {
                type: Sequelize.UUID,
                allowNull: false,
                references: {
                    model: 'users',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'RESTRICT'
            },
            createdAt: {
                allowNull: false,
                type: Sequelize.DATE
            },
            updatedAt: {
                allowNull: false,
                type: Sequelize.DATE
            }
        });

        await queryInterface.addIndex('photos', ['eventId']);
        await queryInterface.addIndex('photos', ['processingStatus']);
        await queryInterface.addIndex('photos', ['rekognitionFaceId']);
        await queryInterface.addIndex('photos', ['uploadedBy']);
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.dropTable('photos');
    }
};
