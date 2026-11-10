import { defineConfig } from 'prisma/config';
import safety from './test/e2e-safety.cjs';

const { config } = safety.loadE2EMigrationConfig();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: config.DATABASE_URL,
  },
});
