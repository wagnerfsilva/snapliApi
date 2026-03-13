'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('orders', 'downloadToken', {
            type: Sequelize.STRING,
            allowNull: true,
            unique: true,
            comment: 'Unique token for accessing download portal'
        });

        await queryInterface.addIndex('orders', ['downloadToken'], {
            name: 'orders_download_token_idx'
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeIndex('orders', 'orders_download_token_idx');
        await queryInterface.removeColumn('orders', 'downloadToken');
    }
};
