'use strict';

// Adds explicit RESTRICTIVE deny-all policies on all public tables.
// Intent: block any direct PostgREST (anon/authenticated) access entirely.
// Without policies, RLS defaults to "deny all" anyway — these policies make
// the intent explicit and silence the rls_enabled_no_policy linter warning.

const TABLES = ['users', 'events', 'photos', 'orders', 'order_items', '"SequelizeMeta"'];

module.exports = {
    async up(queryInterface) {
        for (const table of TABLES) {
            // Policy name without quotes for the unquoted table name
            const policyName = `block_public_access`;

            await queryInterface.sequelize.query(`
                CREATE POLICY "${policyName}" ON ${table}
                AS RESTRICTIVE
                FOR ALL
                USING (false)
                WITH CHECK (false);
            `);
        }
    },

    async down(queryInterface) {
        for (const table of TABLES) {
            await queryInterface.sequelize.query(`
                DROP POLICY IF EXISTS "block_public_access" ON ${table};
            `);
        }
    }
};
