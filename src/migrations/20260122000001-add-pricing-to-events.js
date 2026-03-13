'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('events', 'pricePerPhoto', {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: true,
            defaultValue: 5.00,
            comment: 'Preço por foto individual'
        });

        await queryInterface.addColumn('events', 'pricingPackages', {
            type: Sequelize.JSON,
            allowNull: true,
            defaultValue: null,
            comment: 'Array de pacotes: [{quantity: 5, price: 4.00}, {quantity: 10, price: 7.00}]'
        });

        await queryInterface.addColumn('events', 'allPhotosPrice', {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: true,
            defaultValue: null,
            comment: 'Preço para comprar todas as fotos do evento'
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn('events', 'pricePerPhoto');
        await queryInterface.removeColumn('events', 'pricingPackages');
        await queryInterface.removeColumn('events', 'allPhotosPrice');
    }
};
