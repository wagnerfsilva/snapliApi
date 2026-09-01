'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('events', 'organizerId', {
            type: Sequelize.UUID,
            allowNull: true,
            references: {
                model: 'users',
                key: 'id'
            },
            comment: 'Organizador (role organizador) vinculado ao evento, para cálculo de comissão'
        });

        await queryInterface.addColumn('events', 'organizerCommissionPercentage', {
            type: Sequelize.DECIMAL(5, 2),
            allowNull: true,
            defaultValue: null,
            comment: 'Percentual de comissão do organizador sobre o valor bruto vendido do evento'
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn('events', 'organizerCommissionPercentage');
        await queryInterface.removeColumn('events', 'organizerId');
    }
};
