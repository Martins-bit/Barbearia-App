import path from 'node:path';
import { resolveBackendEnvPath } from './admin-cli-safety';

describe('admin CLI environment path', () => {
  it('resolves backend/.env for ts-node script location', () => {
    const scriptDirectory = path.resolve('C:', 'repo', 'backend', 'scripts');
    const backendEnv = path.resolve(scriptDirectory, '..', '.env');
    const resolved = resolveBackendEnvPath(scriptDirectory, (candidate) =>
      candidate === backendEnv,
    );

    expect(resolved).toBe(backendEnv);
  });

  it('resolves backend/.env for compiled dist/scripts location', () => {
    const scriptDirectory = path.resolve(
      'C:',
      'repo',
      'backend',
      'dist',
      'scripts',
    );
    const backendEnv = path.resolve(
      scriptDirectory,
      '..',
      '..',
      '.env',
    );
    const resolved = resolveBackendEnvPath(scriptDirectory, (candidate) =>
      candidate === backendEnv,
    );

    expect(resolved).toBe(backendEnv);
  });

  it('falls back to backend/.env without consulting cwd', () => {
    const scriptDirectory = path.resolve('C:', 'repo', 'backend', 'scripts');
    const resolved = resolveBackendEnvPath(scriptDirectory, () => false);

    expect(resolved).toBe(path.resolve(scriptDirectory, '..', '.env'));
  });
});
