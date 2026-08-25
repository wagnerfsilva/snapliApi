'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('events', 'freePhotosCount', {
            type: Sequelize.INTEGER,
            allowNull: true,
            defaultValue: 0,
            comment: 'Quantidade de fotos grátis na compra (máx. 3)'
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn('events', 'freePhotosCount');
    }
};
