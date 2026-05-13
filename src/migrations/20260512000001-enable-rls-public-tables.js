'use strict';

// Security: Enable Row Level Security (RLS) on all public tables to prevent
// direct exposure via Supabase PostgREST (anon/authenticated roles).
// The backend API uses a direct Postgres connection (postgres/service_role),
// which bypasses RLS, so app behavior is unaffected.
// This also revokes PostgREST role grants on sensitive tables.

const TABLES = ['users', 'events', 'photos', 'orders', 'order_items', '"SequelizeMeta"'];
const POSTGREST_ROLES = ['anon', 'authenticated'];

module.exports = {
    async up(queryInterface) {
        const ops = [];

        // 1. Enable RLS on every table (blocks anon/authenticated via PostgREST)
        for (const table of TABLES) {
            ops.push(queryInterface.sequelize.query(
                `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`
            ));
            // Force RLS even for table owner (belt-and-suspenders against future role changes)
            ops.push(queryInterface.sequelize.query(
                `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`
            ));
        }

        await Promise.all(ops);

        // 2. Revoke all PostgREST role privileges on each table
        //    (roles may not exist in all environments — ignore errors)
        for (const role of POSTGREST_ROLES) {
            for (const table of TABLES) {
                try {
                    await queryInterface.sequelize.query(
                        `REVOKE ALL PRIVILEGES ON TABLE ${table} FROM ${role};`
                    );
                } catch (_) {
                    // Role or grant may not exist in this environment — safe to skip
                }
            }
        }
    },

    async down(queryInterface) {
        const ops = [];

        // Reverse: disable RLS and restore default grants
        for (const table of TABLES) {
            ops.push(queryInterface.sequelize.query(
                `ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY;`
            ));
            ops.push(queryInterface.sequelize.query(
                `ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;`
            ));
        }

        await Promise.all(ops);

        // Re-grant usage to PostgREST roles (Supabase defaults)
        for (const role of POSTGREST_ROLES) {
            for (const table of TABLES) {
                try {
                    await queryInterface.sequelize.query(
                        `GRANT SELECT ON TABLE ${table} TO ${role};`
                    );
                } catch (_) {
                    // Role may not exist — safe to skip
                }
            }
        }
    }
};
