'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('events', {
            id: {
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4,
                primaryKey: true
            },
            name: {
                type: Sequelize.STRING,
                allowNull: false
            },
            date: {
                type: Sequelize.DATE,
                allowNull: false
            },
            description: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            location: {
                type: Sequelize.STRING,
                allowNull: true
            },
            isActive: {
                type: Sequelize.BOOLEAN,
                defaultValue: true
            },
            photoCount: {
                type: Sequelize.INTEGER,
                defaultValue: 0
            },
            createdBy: {
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

        await queryInterface.addIndex('events', ['date']);
        await queryInterface.addIndex('events', ['isActive']);
        await queryInterface.addIndex('events', ['createdBy']);
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.dropTable('events');
    }
};
