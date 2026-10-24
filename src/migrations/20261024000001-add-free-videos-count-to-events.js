'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('events', 'freeVideosCount', {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('events', 'freeVideosCount');
    }
};
