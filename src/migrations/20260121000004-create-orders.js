'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('orders', {
            id: {
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4,
                primaryKey: true
            },
            userId: {
                type: Sequelize.UUID,
                allowNull: true,
                references: {
                    model: 'users',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            customerEmail: {
                type: Sequelize.STRING,
                allowNull: false
            },
            customerName: {
                type: Sequelize.STRING,
                allowNull: false
            },
            status: {
                type: Sequelize.ENUM('pending', 'processing', 'paid', 'completed', 'cancelled', 'refunded'),
                defaultValue: 'pending',
                allowNull: false
            },
            totalAmount: {
                type: Sequelize.DECIMAL(10, 2),
                allowNull: false,
                defaultValue: 0.00
            },
            paymentMethod: {
                type: Sequelize.STRING,
                allowNull: true
            },
            paymentId: {
                type: Sequelize.STRING,
                allowNull: true
            },
            paymentLink: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            paidAt: {
                type: Sequelize.DATE,
                allowNull: true
            },
            downloadExpiresAt: {
                type: Sequelize.DATE,
                allowNull: true
            },
            notes: {
                type: Sequelize.TEXT,
                allowNull: true
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

        await queryInterface.addIndex('orders', ['status']);
        await queryInterface.addIndex('orders', ['customerEmail']);
        await queryInterface.addIndex('orders', ['paidAt']);
        await queryInterface.addIndex('orders', ['userId']);
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.dropTable('orders');
    }
};
