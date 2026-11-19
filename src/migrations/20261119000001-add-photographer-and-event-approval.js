'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.sequelize.transaction(async transaction => {
            const options = { transaction };
            const userReference = { model: 'users', key: 'id' };
            await queryInterface.addColumn('events', 'photographerId', {
                type: Sequelize.UUID, allowNull: true, references: userReference,
                onUpdate: 'CASCADE', onDelete: 'RESTRICT'
            }, options);
            await queryInterface.addColumn('events', 'photographerCommissionPercentage', {
                type: Sequelize.DECIMAL(5, 2), allowNull: true
            }, options);
            await queryInterface.addColumn('events', 'approvalStatus', {
                type: Sequelize.ENUM('pending', 'approved'), allowNull: false, defaultValue: 'pending'
            }, options);
            await queryInterface.addColumn('events', 'approvedBy', {
                type: Sequelize.UUID, allowNull: true, references: userReference,
                onUpdate: 'CASCADE', onDelete: 'SET NULL'
            }, options);
            await queryInterface.addColumn('events', 'approvedAt', {
                type: Sequelize.DATE, allowNull: true
            }, options);
            await queryInterface.sequelize.query('UPDATE events SET "approvalStatus" = \'approved\'', options);
            await queryInterface.sequelize.query(`
                ALTER TABLE events ADD CONSTRAINT event_commission_limit CHECK (
                    COALESCE("organizerCommissionPercentage", 0) BETWEEN 0 AND 100
                    AND COALESCE("photographerCommissionPercentage", 0) BETWEEN 0 AND 100
                    AND COALESCE("organizerCommissionPercentage", 0)
                        + COALESCE("photographerCommissionPercentage", 0) <= 100
                )
            `, options);
            await queryInterface.addIndex('events', ['photographerId'], options);
            await queryInterface.addIndex('events', ['approvalStatus'], options);

            await queryInterface.addColumn('withdrawal_requests', 'photographerId', {
                type: Sequelize.UUID, allowNull: true, references: userReference,
                onUpdate: 'CASCADE', onDelete: 'RESTRICT'
            }, options);
            await queryInterface.sequelize.query(`
                ALTER TABLE withdrawal_requests ALTER COLUMN "organizerId" DROP NOT NULL;
                ALTER TABLE withdrawal_requests ADD CONSTRAINT withdrawal_one_beneficiary
                    CHECK (("organizerId" IS NOT NULL) <> ("photographerId" IS NOT NULL))
            `, options);
            await queryInterface.addIndex('withdrawal_requests', ['photographerId'], options);
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async transaction => {
            const options = { transaction };
            await queryInterface.sequelize.query('LOCK TABLE withdrawal_requests IN EXCLUSIVE MODE', options);
            const [rows] = await queryInterface.sequelize.query(
                'SELECT id FROM withdrawal_requests WHERE "photographerId" IS NOT NULL LIMIT 1', options
            );
            if (rows.length) {
                throw new Error('Existem saques de fotografos. Resolva o historico antes de reverter esta migracao.');
            }
            await queryInterface.sequelize.query(`
                ALTER TABLE withdrawal_requests DROP CONSTRAINT withdrawal_one_beneficiary;
                ALTER TABLE withdrawal_requests ALTER COLUMN "organizerId" SET NOT NULL;
                ALTER TABLE events DROP CONSTRAINT event_commission_limit
            `, options);
            await queryInterface.removeColumn('withdrawal_requests', 'photographerId', options);
            for (const column of ['approvedAt', 'approvedBy', 'approvalStatus', 'photographerCommissionPercentage', 'photographerId']) {
                await queryInterface.removeColumn('events', column, options);
            }
            await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_events_approvalStatus"', options);
        });
    }
};
