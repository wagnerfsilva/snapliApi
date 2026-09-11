'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('users', 'pixKey', {
            type: Sequelize.STRING,
            allowNull: true,
            comment: 'Chave PIX do organizador, usada para pagamento dos resgates'
        });

        await queryInterface.addColumn('withdrawal_requests', 'pixKey', {
            type: Sequelize.STRING,
            allowNull: true,
            comment: 'Cópia da chave PIX do organizador no momento da solicitação de resgate'
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn('withdrawal_requests', 'pixKey');
        await queryInterface.removeColumn('users', 'pixKey');
    }
};
