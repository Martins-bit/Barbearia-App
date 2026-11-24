import path from 'node:path';
import { resolveBackendEnvPath } from '../../scripts/admin-cli-safety';

describe('admin CLI environment path', () => {
  it('resolves backend/.env for ts-node script location', () => {
    const scriptDirectory = path.resolve('C:', 'repo', 'backend', 'scripts');
    const backendEnv = path.resolve(scriptDirectory, '..', '.env');

    expect(
      resolveBackendEnvPath(scriptDirectory, (candidate) => candidate === backendEnv),
    ).toBe(backendEnv);
  });

  it('resolves backend/.env for compiled dist/scripts location', () => {
    const scriptDirectory = path.resolve(
      'C:',
      'repo',
      'backend',
      'dist',
      'scripts',
    );
    const backendEnv = path.resolve(scriptDirectory, '..', '..', '.env');

    expect(
      resolveBackendEnvPath(scriptDirectory, (candidate) => candidate === backendEnv),
    ).toBe(backendEnv);
  });

  it('does not depend on cwd when no .env exists', () => {
    const scriptDirectory = path.resolve('C:', 'repo', 'backend', 'scripts');
    expect(resolveBackendEnvPath(scriptDirectory, () => false)).toBe(
      path.resolve(scriptDirectory, '..', '.env'),
    );
  });
});
