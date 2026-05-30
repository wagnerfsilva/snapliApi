'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        // Rename enum value 'client' → 'fotografo' (PostgreSQL 10+)
        await queryInterface.sequelize.query(
            `ALTER TYPE "enum_users_role" RENAME VALUE 'client' TO 'fotografo';`
        );

        // Update all users except the real admin to 'fotografo'
        await queryInterface.sequelize.query(
            `UPDATE users SET role = 'fotografo' WHERE email != 'admin@snapli.com.br';`
        );
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.sequelize.query(
            `UPDATE users SET role = 'client' WHERE role = 'fotografo';`
        );
        await queryInterface.sequelize.query(
            `ALTER TYPE "enum_users_role" RENAME VALUE 'fotografo' TO 'client';`
        );
    }
};
