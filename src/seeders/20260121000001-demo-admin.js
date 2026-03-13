'use strict';

const bcrypt = require('bcrypt');

module.exports = {
    async up(queryInterface, Sequelize) {
        const hashedPassword = await bcrypt.hash('%65434343', 10);

        await queryInterface.bulkInsert('users', [
            {
                id: Sequelize.literal('gen_random_uuid()'),
                email: 'fotografo@gmail.com',
                password: hashedPassword,
                name: 'Administrador',
                role: 'admin',
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date()
            }
        ]);
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.bulkDelete('users', {
            email: 'fotografo@gmail.com'
        });
    }
};
