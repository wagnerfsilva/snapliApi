'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('order_items', {
            id: {
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4,
                primaryKey: true
            },
            orderId: {
                type: Sequelize.UUID,
                allowNull: false,
                references: {
                    model: 'orders',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            photoId: {
                type: Sequelize.UUID,
                allowNull: false,
                references: {
                    model: 'photos',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'RESTRICT'
            },
            price: {
                type: Sequelize.DECIMAL(10, 2),
                allowNull: false,
                defaultValue: 0.00
            },
            downloadUrl: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            downloadedAt: {
                type: Sequelize.DATE,
                allowNull: true
            },
            downloadCount: {
                type: Sequelize.INTEGER,
                defaultValue: 0
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

        await queryInterface.addIndex('order_items', ['orderId']);
        await queryInterface.addIndex('order_items', ['photoId']);
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.dropTable('order_items');
    }
};
