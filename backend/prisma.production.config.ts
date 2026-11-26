import { defineConfig } from 'prisma/config';
import safety from './scripts/production-first-install.cjs';

safety.assertProductionConfigInvocation(process.argv, process.env);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
