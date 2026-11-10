<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# E2E safety checks (do not connect to a database)
$ npm run test:e2e:guard

# E2E tests (requires the isolated database configuration below)
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

### E2E database isolation

Before running E2E tests, create `test/.env.e2e` from
`test/.env.e2e.example` and configure its `DATABASE_URL` for the isolated
PostgreSQL database named exactly `barbearia_app_e2e` on loopback
(`127.0.0.1` or `::1`) with explicit port `5432`, using the dedicated
`barbearia_e2e_test` role. Set a test-only
`JWT_SECRET` there as well. This configuration is separate from `.env` and is
ignored by Git. The role must not own the schema or have database/role
administration privileges; it needs only connection, schema usage, CRUD on test
tables, and sequence usage/update.

Migrations use a separate `test/.env.e2e.migrate`, copied from
`test/.env.e2e.migrate.example`, with the non-superuser
`barbearia_e2e_migrator` role. That role receives only privileges needed to
apply migrations in the isolated database. Neither role is created by the
application, and neither may reuse the backend `.env` credentials.

The `test:e2e` command validates that file before starting Jest. The Jest E2E
setup repeats the validation before loading test suites, including when Jest is
invoked directly with `test/jest-e2e.json`. Missing configuration or an
invalid protocol, host, port, database, role, or URL parameter blocks
execution; there is no fallback to `.env`. Child processes receive a
sanitized database environment with inherited `DATABASE_URL`, `DIRECT_URL`,
Prisma URL, and `PG*` variables removed. The guard does not create or clean
the database.

For the official E2E migration workflow, use `npm run db:e2e:migrate`. It
validates the migration-specific environment file and invokes only
`prisma migrate deploy` with `prisma.e2e.config.ts` explicitly selected. That config requires the
explicit marker `E2E_MIGRATION_RUNNER_AUTH=1` as confirmation to apply E2E
migrations. The marker is reproducible and does not prove that the runner was
used. The official runner fixes the config path and rejects a `--config`
override. This is a local safeguard for the official path, not a universal
block against arbitrary Prisma configs supplied directly to the CLI; such a
config can bypass local guards. The definitive boundary must be least-privilege
PostgreSQL roles.

When the default `prisma.config.ts` is selected, it blocks `migrate` and
`db push` unless
`PRISMA_MIGRATION_TARGET=development` is explicitly set and the connection
targets local `barbearia_app` on port 5432. For normal local development, from
`backend`, use:

```powershell
$env:PRISMA_MIGRATION_TARGET = 'development'
npx prisma migrate dev
Remove-Item Env:PRISMA_MIGRATION_TARGET
```

The default config never authorizes `barbearia_app_e2e` or remote hosts. This
validation applies only when that config is selected; it cannot prevent use of
an arbitrary external `--config` file.

Diagnostic `_diag-*` E2E files are excluded from the normal E2E selection and
are not run automatically. Any manual diagnostic execution must also pass the
same database safety check.

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
