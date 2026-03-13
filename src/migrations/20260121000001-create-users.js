'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('users', {
            id: {
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4,
                primaryKey: true
            },
            email: {
                type: Sequelize.STRING,
                allowNull: false,
                unique: true
            },
            password: {
                type: Sequelize.STRING,
                allowNull: false
            },
            name: {
                type: Sequelize.STRING,
                allowNull: false
            },
            role: {
                type: Sequelize.ENUM('admin', 'client'),
                defaultValue: 'admin',
                allowNull: false
            },
            isActive: {
                type: Sequelize.BOOLEAN,
                defaultValue: true
            },
            lastLogin: {
                type: Sequelize.DATE,
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

        await queryInterface.addIndex('users', ['email']);
        await queryInterface.addIndex('users', ['role']);
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.dropTable('users');
    }
};
