'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.sequelize.query(
            `ALTER TYPE "enum_orders_status" ADD VALUE IF NOT EXISTS 'courtesy'`
        );
        await queryInterface.sequelize.transaction(async transaction => {
            await queryInterface.changeColumn('orders', 'customerEmail', {
                type: Sequelize.STRING,
                allowNull: true
            }, { transaction });
            await queryInterface.addColumn('orders', 'createdBy', {
                type: Sequelize.UUID,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            }, { transaction });
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.sequelize.transaction(async transaction => {
            await queryInterface.sequelize.query('LOCK TABLE orders IN ACCESS EXCLUSIVE MODE', { transaction });
            const [rows] = await queryInterface.sequelize.query(
                `SELECT COUNT(*) AS count FROM orders WHERE status = 'courtesy' OR "customerEmail" IS NULL`,
                { transaction }
            );
            if (Number(rows[0].count) > 0) {
                throw new Error('Cannot revert: courtesy orders or orders without email still exist. Preserve/export them before rollback.');
            }
            await queryInterface.removeColumn('orders', 'createdBy', { transaction });
            await queryInterface.changeColumn('orders', 'customerEmail', {
                type: Sequelize.STRING,
                allowNull: false
            }, { transaction });
            await queryInterface.sequelize.query(`
                ALTER TABLE orders ALTER COLUMN status DROP DEFAULT;
                ALTER TABLE orders ALTER COLUMN status TYPE text USING status::text;
                DROP TYPE "enum_orders_status";
                CREATE TYPE "enum_orders_status" AS ENUM ('pending', 'processing', 'paid', 'completed', 'cancelled', 'refunded');
                ALTER TABLE orders ALTER COLUMN status TYPE "enum_orders_status" USING status::"enum_orders_status";
                ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending'::"enum_orders_status";
            `, { transaction });
        });
    }
};
