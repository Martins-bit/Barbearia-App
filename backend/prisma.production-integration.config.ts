import { defineConfig } from 'prisma/config';
import safety from './test/production-first-install.integration-safety.cjs';

safety.assertIntegrationConfigInvocation(process.argv, process.env);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.PRODUCTION_MIGRATION_TEST_DATABASE_URL,
  },
});
