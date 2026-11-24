import fs from 'node:fs';
import path from 'node:path';

export function resolveBackendEnvPath(
  scriptDirectory: string,
  exists: (candidate: string) => boolean = fs.existsSync,
): string {
  const isCompiledScript =
    scriptDirectory.split(path.sep).includes('dist') &&
    path.basename(scriptDirectory) === 'scripts';
  const candidates = isCompiledScript
    ? [
        path.resolve(scriptDirectory, '..', '..', '.env'),
        path.resolve(scriptDirectory, '..', '.env'),
      ]
    : [
        path.resolve(scriptDirectory, '..', '.env'),
        path.resolve(scriptDirectory, '..', '..', '.env'),
      ];

  return candidates.find((candidate) => exists(candidate)) ?? candidates[0];
}
