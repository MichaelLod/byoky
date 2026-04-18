import { defineConfig } from 'drizzle-kit';

// WARNING — do not run `pnpm db:push` against prod without inspecting
// the proposed statements. Two known traps:
//
//   1. The vault shares its Postgres instance with the marketplace package
//      (which owns `marketplace_gifts`). tablesFilter below scopes the
//      diff to tables this package owns so push does not propose dropping
//      marketplace data.
//   2. An older drizzle-kit left behind named `*_not_null` constraints on
//      every NOT NULL column. Current drizzle-kit treats them as drift and
//      proposes `DROP CONSTRAINT <col>_not_null` for each one, which would
//      make those columns nullable. Push will error out on the PK columns
//      but may silently drop constraints on non-PK columns before hitting
//      that error. Until those constraints are cleaned up, prefer raw SQL
//      (inside a transaction) for schema changes.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  tablesFilter: [
    'users',
    'credentials',
    'user_sessions',
    'app_sessions',
    'groups',
    'app_groups',
    'request_log',
    'gifts',
  ],
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
