'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.sequelize.query(
            `ALTER TYPE "enum_users_role" ADD VALUE IF NOT EXISTS 'organizador';`
        );
    },

    async down(queryInterface, Sequelize) {
        // Postgres não suporta remover valor de ENUM diretamente.
        // Reverter exigiria recriar o tipo; deixado como no-op por segurança.
    }
};
