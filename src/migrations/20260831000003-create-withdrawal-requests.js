'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('withdrawal_requests', {
            id: {
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4,
                primaryKey: true
            },
            eventId: {
                type: Sequelize.UUID,
                allowNull: false,
                references: {
                    model: 'events',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            organizerId: {
                type: Sequelize.UUID,
                allowNull: false,
                references: {
                    model: 'users',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'RESTRICT'
            },
            amount: {
                type: Sequelize.DECIMAL(10, 2),
                allowNull: false
            },
            status: {
                type: Sequelize.ENUM('pending', 'approved', 'rejected', 'paid'),
                defaultValue: 'pending',
                allowNull: false
            },
            notes: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            adminNotes: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            processedBy: {
                type: Sequelize.UUID,
                allowNull: true,
                references: {
                    model: 'users',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            processedAt: {
                type: Sequelize.DATE,
                allowNull: true
            },
            createdAt: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
            },
            updatedAt: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
            }
        });

        await queryInterface.addIndex('withdrawal_requests', ['eventId']);
        await queryInterface.addIndex('withdrawal_requests', ['organizerId']);
        await queryInterface.addIndex('withdrawal_requests', ['status']);

        // Security: same RLS lockdown applied to other public tables (see
        // 20260512000001/20260512000002) — blocks direct PostgREST access via
        // anon/authenticated roles. Backend API uses a direct Postgres connection
        // (bypasses RLS), so app behavior is unaffected.
        await queryInterface.sequelize.query(
            'ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;'
        );
        await queryInterface.sequelize.query(
            'ALTER TABLE withdrawal_requests FORCE ROW LEVEL SECURITY;'
        );
        for (const role of ['anon', 'authenticated']) {
            try {
                await queryInterface.sequelize.query(
                    `REVOKE ALL PRIVILEGES ON TABLE withdrawal_requests FROM ${role};`
                );
            } catch (_) {
                // Role or grant may not exist in this environment — safe to skip
            }
        }
        await queryInterface.sequelize.query(`
            CREATE POLICY "block_public_access" ON withdrawal_requests
            AS RESTRICTIVE
            FOR ALL
            USING (false)
            WITH CHECK (false);
        `);
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.dropTable('withdrawal_requests');
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_withdrawal_requests_status";');
    }
};
