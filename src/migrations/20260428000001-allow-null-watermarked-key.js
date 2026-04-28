'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.changeColumn('photos', 'watermarkedKey', {
            type: Sequelize.STRING,
            allowNull: true
        });
    },

    async down(queryInterface, Sequelize) {
        // Revert: set any null values to empty string first to avoid constraint violation
        await queryInterface.sequelize.query(
            `UPDATE photos SET "watermarkedKey" = '' WHERE "watermarkedKey" IS NULL`
        );
        await queryInterface.changeColumn('photos', 'watermarkedKey', {
            type: Sequelize.STRING,
            allowNull: false
        });
    }
};
