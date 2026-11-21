import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { hostname } from 'node:os';
import { join } from 'node:path';
import {
  TemporaryExportCleanupError,
  TemporaryExportLimitError,
  TemporaryExportStorageError,
  TemporaryExportStorageService,
} from './temporary-export-storage.service';

const mockUnlink = jest.fn();
const mockRmdir = jest.fn();

jest.mock('node:fs/promises', () => {
  const actual = jest.requireActual('node:fs/promises');
  return {
    ...actual,
    unlink: (...args: unknown[]) => mockUnlink(...args),
    rmdir: (...args: unknown[]) => mockRmdir(...args),
  };
});

const actualFsPromises =
  jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');

const INSTANCE_DIRECTORY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:part|ready)$/;

describe('TemporaryExportStorageService', () => {
  let rootDirectory: string;
  let services: TemporaryExportStorageService[];

  beforeEach(async () => {
    mockUnlink.mockReset().mockImplementation(actualFsPromises.unlink);
    mockRmdir.mockReset().mockImplementation(actualFsPromises.rmdir);
    rootDirectory = await mkdtemp(
      join(tmpdir(), 'barbearia-export-storage-test-'),
    );
    services = [];
  });

  afterEach(async () => {
    mockUnlink.mockReset().mockImplementation(actualFsPromises.unlink);
    mockRmdir.mockReset().mockImplementation(actualFsPromises.rmdir);
    for (const service of services) {
      await service.onModuleDestroy().catch(() => undefined);
    }
    await rm(rootDirectory, { recursive: true, force: true });
  });

  async function createStorage(
    limits: { maxFileSizeBytes?: number; maxTotalSizeBytes?: number } = {},
  ): Promise<TemporaryExportStorageService> {
    const storage = new TemporaryExportStorageService({
      rootDirectory,
      ...limits,
    });
    services.push(storage);
    await storage.onModuleInit();
    return storage;
  }

  async function instanceDirectories(): Promise<string[]> {
    const entries = await readdir(rootDirectory, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() && INSTANCE_DIRECTORY_PATTERN.test(entry.name),
      )
      .map((entry) => join(rootDirectory, entry.name));
  }

  async function instanceFiles(directory: string): Promise<string[]> {
    return readdir(directory);
  }

  async function deadProcessId(): Promise<number> {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
      stdio: 'ignore',
    });
    const [exitCode] = (await once(child, 'exit')) as [number | null];
    expect(exitCode).toBe(0);
    if (!child.pid) {
      throw new Error('The child process did not expose a PID.');
    }
    return child.pid;
  }

  function runCommand(
    executable: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolveOutput, reject) => {
      execFile(
        executable,
        args,
        { encoding: 'utf8', maxBuffer: 16 * 1024, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
            const code = (error as NodeJS.ErrnoException).code ?? 'unknown';
            reject(
              new Error(
                `Command "${executable}" failed with code ${code}${
                  stderr.trim() ? `; stderr: ${stderr.trim()}` : ''
                }`,
                { cause: error },
              ),
            );
          } else {
            resolveOutput({ stdout, stderr });
          }
        },
      );
    });
  }

  interface WindowsAclEntry {
    sid: string;
    rights: string;
    accessType: string;
    inheritanceFlags: string;
    propagationFlags: string;
    isInherited: boolean;
  }

  interface WindowsAcl {
    isProtected: boolean;
    entries: WindowsAclEntry[];
  }

  async function windowsAcl(directory: string): Promise<WindowsAcl> {
    const encodedPath = Buffer.from(directory, 'utf16le').toString('base64');
    const script = [
      '$ErrorActionPreference = "Stop"',
      'try {',
      `  $path = [System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String('${encodedPath}'))`,
      '  if ([System.IO.Directory]::Exists($path)) { $acl = [System.IO.Directory]::GetAccessControl($path) } else { $acl = [System.IO.File]::GetAccessControl($path) }',
      '  $rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.NTAccount])',
      '  $entries = @($rules | ForEach-Object {',
      '    $identity = $_.IdentityReference.Value',
      '    try {',
      '      $sid = $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value',
      '    } catch {',
      '      throw "Cannot translate ACL identity $identity to SID: $($_.Exception.Message)"',
      '    }',
      '    [pscustomobject]@{',
      '      sid = $sid',
      '      rights = [string]$_.FileSystemRights',
      '      accessType = [string]$_.AccessControlType',
      '      inheritanceFlags = [string]$_.InheritanceFlags',
      '      propagationFlags = [string]$_.PropagationFlags',
      '      isInherited = [bool]$_.IsInherited',
      '    }',
      '  })',
      '  if ($entries.Count -eq 0) { throw "ACL API returned no access control entries" }',
      '  [pscustomobject]@{ isProtected = [bool]$acl.AreAccessRulesProtected; entries = $entries } | ConvertTo-Json -Depth 4 -Compress',
      '} catch {',
      '  [Console]::Error.WriteLine($_.Exception.Message)',
      '  exit 1',
      '}',
    ].join('\n');
    const { stdout, stderr } = await runCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ]);
    const stderrOutput = stderr.trim();
    const startupProgressOnly =
      stderrOutput.startsWith('#< CLIXML') &&
      /<Obj S="progress"/i.test(stderrOutput) &&
      !/<Obj S="(?:error|warning)"/i.test(stderrOutput);
    if (stderrOutput && !startupProgressOnly) {
      throw new Error(`PowerShell ACL query wrote to stderr: ${stderr.trim()}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch (error) {
      throw new Error(
        `PowerShell ACL query returned invalid JSON: ${stdout.trim() || '<empty output>'}`,
        { cause: error },
      );
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('isProtected' in parsed) ||
      typeof parsed.isProtected !== 'boolean' ||
      !('entries' in parsed)
    ) {
      throw new Error('PowerShell ACL query returned an invalid result shape.');
    }

    const entries = Array.isArray(parsed.entries)
      ? parsed.entries
      : [parsed.entries];
    if (entries.length === 0) {
      throw new Error('PowerShell ACL query returned no usable ACEs.');
    }
    for (const entry of entries) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        !('sid' in entry) ||
        typeof entry.sid !== 'string' ||
        !/^S-\d+(?:-\d+)+$/.test(entry.sid) ||
        !('rights' in entry) ||
        typeof entry.rights !== 'string' ||
        !('accessType' in entry) ||
        typeof entry.accessType !== 'string' ||
        !('inheritanceFlags' in entry) ||
        typeof entry.inheritanceFlags !== 'string' ||
        !('propagationFlags' in entry) ||
        typeof entry.propagationFlags !== 'string' ||
        !('isInherited' in entry) ||
        typeof entry.isInherited !== 'boolean'
      ) {
        throw new Error(
          `PowerShell ACL query returned an unusable ACE: ${JSON.stringify(entry)}`,
        );
      }
    }

    return {
      isProtected: parsed.isProtected,
      entries: entries as WindowsAclEntry[],
    };
  }

  async function ownerMarker(instanceId: string, pid: number): Promise<string> {
    const marker: {
      pid: number;
      instanceId: string;
      hostname: string;
      pidNamespace?: string;
    } = { pid, instanceId, hostname: hostname() };
    if (process.platform === 'linux') {
      const { readlink } = await import('node:fs/promises');
      marker.pidNamespace = await readlink('/proc/self/ns/pid');
    }
    return JSON.stringify(marker);
  }

  it('creates private .part files with random, non-personal names', async () => {
    const storage = await createStorage();
    const first = await storage.create();
    const second = await storage.create();
    const [directory] = await instanceDirectories();
    const files = await instanceFiles(directory);

    expect(files).toHaveLength(3);
    const temporaryNames = files.filter((name) => name.endsWith('.part'));
    expect(temporaryNames).toHaveLength(2);
    expect(temporaryNames.every((name) => FILE_PATTERN.test(name))).toBe(true);
    expect(temporaryNames[0]).not.toBe(temporaryNames[1]);
    expect(temporaryNames.join(' ')).not.toMatch(
      /nome|email|cliente|barbeiro/i,
    );

    if (process.platform !== 'win32') {
      const directoryInfo = await lstat(directory);
      expect(directoryInfo.mode & 0o777).toBe(0o700);
      const fileInfo = await lstat(join(directory, temporaryNames[0]));
      expect(fileInfo.mode & 0o777).toBe(0o600);
    }

    await first.cancel();
    await second.cancel();
  });

  it('restricts Windows ACLs to the service account, SYSTEM, and Administrators', async () => {
    if (process.platform !== 'win32') {
      return;
    }

    const storage = await createStorage();
    const file = await storage.create();
    const [instanceDirectory] = await instanceDirectories();
    const { stdout: identity } = await runCommand('whoami.exe', [
      '/user',
      '/fo',
      'csv',
      '/nh',
    ]);
    const serviceSid = identity.match(/"(S-\d+(?:-\d+)+)"/)?.[1];
    expect(serviceSid).toBeDefined();
    const expectedSids = [serviceSid!, 'S-1-5-18', 'S-1-5-32-544'].sort();
    const partName = (await instanceFiles(instanceDirectory)).find((name) =>
      name.endsWith('.part'),
    );
    if (!partName) {
      throw new Error('The partial export file was not created.');
    }
    await file.write(Buffer.from('complete'));
    const partAcl = await windowsAcl(join(instanceDirectory, partName));

    const directories = [
      await windowsAcl(rootDirectory),
      await windowsAcl(instanceDirectory),
    ];
    for (const acl of directories) {
      expect(acl.isProtected).toBe(true);
      expect(acl.entries.map((entry) => entry.sid).sort()).toEqual(
        expectedSids,
      );
      for (const entry of acl.entries) {
        expect(entry).toMatchObject({
          rights: 'FullControl',
          accessType: 'Allow',
          inheritanceFlags: 'ContainerInherit, ObjectInherit',
          propagationFlags: 'None',
          isInherited: false,
        });
      }
    }

    const assertPrivateFileAcl = (acl: WindowsAcl): void => {
      expect(acl.entries.map((entry) => entry.sid).sort()).toEqual(
        expectedSids,
      );
      for (const entry of acl.entries) {
        expect(entry).toMatchObject({
          rights: 'FullControl',
          accessType: 'Allow',
          propagationFlags: 'None',
          isInherited: true,
        });
      }
    };
    assertPrivateFileAcl(partAcl);

    await file.finalize();
    const readyName = (await instanceFiles(instanceDirectory)).find((name) =>
      name.endsWith('.ready'),
    );
    if (!readyName) {
      throw new Error('The finalized export file was not created.');
    }
    assertPrivateFileAcl(await windowsAcl(join(instanceDirectory, readyName)));
    await file.cancel();
  }, 30_000);

  it('uses a fresh random name for every file', async () => {
    const storage = await createStorage();
    const handles = await Promise.all([
      storage.create(),
      storage.create(),
      storage.create(),
    ]);
    const [directory] = await instanceDirectories();
    const names = (await instanceFiles(directory)).filter((name) =>
      name.endsWith('.part'),
    );

    expect(new Set(names).size).toBe(3);
    expect(names.every((name) => FILE_PATTERN.test(name))).toBe(true);
    await Promise.all(handles.map((handle) => handle.cancel()));
  });

  it('supports progressive writes and exposes a readable stream only after finalization', async () => {
    const storage = await createStorage();
    const file = await storage.create();
    await file.write(Buffer.from('first-'));
    await file.write(Buffer.from('second'));
    expect(file.sizeBytes).toBe(Buffer.byteLength('first-second'));

    const [directory] = await instanceDirectories();
    expect(
      (await instanceFiles(directory)).filter((name) => name.endsWith('.part')),
    ).toHaveLength(1);
    await expect(file.openReadStream()).rejects.toBeInstanceOf(
      TemporaryExportStorageError,
    );

    await file.finalize();
    expect(
      (await instanceFiles(directory)).filter((name) =>
        name.endsWith('.ready'),
      ),
    ).toHaveLength(1);
    const stream = await file.openReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).toString('utf8')).toBe('first-second');
    await file.dispose();
  });

  it('does not accept path traversal as file content or expose file paths', async () => {
    const storage = await createStorage();
    const handle = await storage.create();
    await expect(
      Reflect.apply(handle.write, handle, ['../../outside']),
    ).rejects.toBeInstanceOf(TemporaryExportStorageError);

    const directories = await instanceDirectories();
    expect(directories).toHaveLength(1);
    const files = await instanceFiles(directories[0]);
    expect(files).toEqual(['owner.json']);
    await expect(lstat(join(rootDirectory, 'outside'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('enforces the per-file limit and removes the failed partial file', async () => {
    const storage = await createStorage({
      maxFileSizeBytes: 3,
      maxTotalSizeBytes: 8,
    });
    const file = await storage.create();
    await file.write(Buffer.from('12'));
    await expect(file.write(Buffer.from('34'))).rejects.toBeInstanceOf(
      TemporaryExportLimitError,
    );

    const [directory] = await instanceDirectories();
    expect(await instanceFiles(directory)).toEqual(['owner.json']);
    const replacement = await storage.create();
    await replacement.write(Buffer.from('123'));
    await replacement.dispose();
  });

  it('enforces the total quota across files and releases quota after disposal', async () => {
    const storage = await createStorage({
      maxFileSizeBytes: 5,
      maxTotalSizeBytes: 5,
    });
    const first = await storage.create();
    const second = await storage.create();
    await first.write(Buffer.from('1234'));
    await expect(second.write(Buffer.from('12'))).rejects.toBeInstanceOf(
      TemporaryExportLimitError,
    );

    await first.dispose();
    const replacement = await storage.create();
    await replacement.write(Buffer.from('12345'));
    await replacement.dispose();
  });

  it('cleans the file after cancellation during progressive writing', async () => {
    const storage = await createStorage({
      maxFileSizeBytes: 16 * 1024 * 1024,
      maxTotalSizeBytes: 16 * 1024 * 1024,
    });
    const controller = new AbortController();
    const file = await storage.create(controller.signal);
    const write = file.write(new Uint8Array(8 * 1024 * 1024));
    setImmediate(() => controller.abort());

    await expect(write).rejects.toBeInstanceOf(TemporaryExportStorageError);
    const [directory] = await instanceDirectories();
    expect(await instanceFiles(directory)).toEqual(['owner.json']);
  });

  it('cleans partial and finalized files on explicit cancellation and disposal', async () => {
    const storage = await createStorage();
    const partial = await storage.create();
    await partial.write(Buffer.from('partial'));
    await partial.cancel();
    await expect(partial.write(Buffer.from('late'))).rejects.toBeInstanceOf(
      TemporaryExportStorageError,
    );

    const finalized = await storage.create();
    await finalized.write(Buffer.from('ready'));
    await finalized.finalize();
    await finalized.dispose();

    const [directory] = await instanceDirectories();
    expect(await instanceFiles(directory)).toEqual(['owner.json']);
  });

  it('attempts to remove .ready even when removing .part fails', async () => {
    const storage = await createStorage();
    const file = await storage.create();
    await file.write(Buffer.from('partial'));
    const [directory] = await instanceDirectories();
    const partName = (await instanceFiles(directory)).find((name) =>
      name.endsWith('.part'),
    );
    if (!partName) throw new Error('The partial export file was not created.');
    const partPath = join(directory, partName);
    const readyPath = join(
      directory,
      `${partName.slice(0, -'.part'.length)}.ready`,
    );
    await writeFile(readyPath, 'ready');
    const unlinkSpy = mockUnlink.mockImplementation((path: unknown) => {
      if (String(path) === partPath) {
        return Promise.reject(
          Object.assign(new Error('file busy'), { code: 'EBUSY' }),
        );
      }
      return actualFsPromises.unlink(path as string);
    });

    try {
      await expect(file.dispose()).rejects.toBeInstanceOf(
        TemporaryExportCleanupError,
      );
      expect(unlinkSpy).toHaveBeenCalledWith(readyPath);
      await expect(lstat(partPath)).resolves.toBeDefined();
      await expect(lstat(readyPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      mockUnlink.mockReset().mockImplementation(actualFsPromises.unlink);
      await file.dispose();
    }
  });

  it('keeps a finalized .ready file tracked when its removal fails', async () => {
    const storage = await createStorage();
    const file = await storage.create();
    await file.write(Buffer.from('ready'));
    await file.finalize();
    const [directory] = await instanceDirectories();
    const readyName = (await instanceFiles(directory)).find((name) =>
      name.endsWith('.ready'),
    );
    if (!readyName) throw new Error('The finalized file was not created.');
    const readyPath = join(directory, readyName);
    const unlinkSpy = mockUnlink.mockImplementation((path: unknown) =>
      String(path) === readyPath
        ? Promise.reject(
            Object.assign(new Error('file busy'), { code: 'EBUSY' }),
          )
        : actualFsPromises.unlink(path as string),
    );

    try {
      await expect(file.dispose()).rejects.toBeInstanceOf(
        TemporaryExportCleanupError,
      );
      await expect(lstat(readyPath)).resolves.toBeDefined();
      expect(unlinkSpy).toHaveBeenCalledWith(readyPath);
      expect(file.sizeBytes).toBe(Buffer.byteLength('ready'));
    } finally {
      mockUnlink.mockReset().mockImplementation(actualFsPromises.unlink);
      await file.dispose();
    }
  });

  it('treats ENOENT as an already completed file removal', async () => {
    const storage = await createStorage();
    const file = await storage.create();
    await file.write(Buffer.from('partial'));
    const [directory] = await instanceDirectories();
    const partName = (await instanceFiles(directory)).find((name) =>
      name.endsWith('.part'),
    );
    if (!partName) throw new Error('The partial export file was not created.');

    await actualFsPromises.unlink(join(directory, partName));
    await expect(file.dispose()).resolves.toBeUndefined();
    expect(file.sizeBytes).toBe(0);
  });

  it('retries a transient unlink failure and completes cleanup', async () => {
    const storage = await createStorage();
    const file = await storage.create();
    await file.write(Buffer.from('partial'));
    const [directory] = await instanceDirectories();
    const partName = (await instanceFiles(directory)).find((name) =>
      name.endsWith('.part'),
    );
    if (!partName) throw new Error('The partial export file was not created.');
    const partPath = join(directory, partName);
    let attempts = 0;
    const unlinkSpy = mockUnlink.mockImplementation((path: unknown) => {
      if (String(path) === partPath && attempts++ === 0) {
        return Promise.reject(
          Object.assign(new Error('temporary sharing violation'), {
            code: 'EPERM',
          }),
        );
      }
      return actualFsPromises.unlink(path as string);
    });

    try {
      await expect(file.dispose()).resolves.toBeUndefined();
      expect(attempts).toBe(2);
      expect(unlinkSpy).toHaveBeenCalledTimes(2);
      await expect(lstat(partPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      mockUnlink.mockReset().mockImplementation(actualFsPromises.unlink);
    }
  });

  it('keeps persistent cleanup failures accounted until a later retry succeeds', async () => {
    const storage = await createStorage({
      maxFileSizeBytes: 3,
      maxTotalSizeBytes: 3,
    });
    const file = await storage.create();
    await file.write(Buffer.from('123'));
    const [directory] = await instanceDirectories();
    const partName = (await instanceFiles(directory)).find((name) =>
      name.endsWith('.part'),
    );
    if (!partName) throw new Error('The partial export file was not created.');
    const partPath = join(directory, partName);
    const unlinkSpy = mockUnlink.mockImplementation((path: unknown) =>
      String(path) === partPath
        ? Promise.reject(
            Object.assign(new Error('access denied'), { code: 'EACCES' }),
          )
        : actualFsPromises.unlink(path as string),
    );

    try {
      await expect(file.dispose()).rejects.toBeInstanceOf(
        TemporaryExportCleanupError,
      );
      expect(unlinkSpy.mock.calls).toHaveLength(3);
      await expect(lstat(partPath)).resolves.toBeDefined();
      const blocked = await storage.create();
      await expect(blocked.write(Buffer.from('1'))).rejects.toBeInstanceOf(
        TemporaryExportLimitError,
      );

      mockUnlink.mockReset().mockImplementation(actualFsPromises.unlink);
      await file.dispose();
      expect(file.sizeBytes).toBe(0);
      const replacement = await storage.create();
      await expect(
        replacement.write(Buffer.from('123')),
      ).resolves.toBeUndefined();
      await replacement.dispose();
    } finally {
      mockUnlink.mockReset().mockImplementation(actualFsPromises.unlink);
    }
  });

  it('retries a pending cleanup automatically during the same process', async () => {
    const storage = await createStorage();
    const file = await storage.create();
    await file.write(Buffer.from('partial'));
    const [directory] = await instanceDirectories();
    const partName = (await instanceFiles(directory)).find((name) =>
      name.endsWith('.part'),
    );
    if (!partName) throw new Error('The partial export file was not created.');
    const partPath = join(directory, partName);
    let attempts = 0;
    let retrySucceeded!: () => void;
    const retryCompleted = new Promise<void>((resolveRetry) => {
      retrySucceeded = resolveRetry;
    });
    const unlinkSpy = mockUnlink.mockImplementation(async (path: unknown) => {
      if (String(path) === partPath && attempts++ < 3) {
        throw Object.assign(new Error('temporary sharing violation'), {
          code: 'EBUSY',
        });
      }
      await actualFsPromises.unlink(path as string);
      if (String(path) === partPath) retrySucceeded();
    });

    try {
      await expect(file.dispose()).rejects.toBeInstanceOf(
        TemporaryExportCleanupError,
      );
      expect(attempts).toBe(3);
      await retryCompleted;
      await file.dispose();
      expect(unlinkSpy).toHaveBeenCalledTimes(4);
      await expect(lstat(partPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(file.sizeBytes).toBe(0);
    } finally {
      mockUnlink.mockReset().mockImplementation(actualFsPromises.unlink);
    }
  });

  it('removes its files and instance directory on normal module shutdown', async () => {
    const storage = await createStorage();
    const file = await storage.create();
    await file.write(Buffer.from('temporary'));
    const [directory] = await instanceDirectories();

    await storage.onModuleDestroy();

    await expect(lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(rootDirectory)).toEqual([]);
  });

  it('preserves a safely retryable empty instance directory after shutdown removal fails', async () => {
    const storage = await createStorage();
    const [directory] = await instanceDirectories();
    const rmdirSpy = mockRmdir.mockImplementation((path: unknown) =>
      String(path) === directory
        ? Promise.reject(
            Object.assign(new Error('directory busy'), { code: 'EBUSY' }),
          )
        : actualFsPromises.rmdir(path as string),
    );

    try {
      await expect(storage.onModuleDestroy()).rejects.toBeInstanceOf(
        TemporaryExportStorageError,
      );
      expect(rmdirSpy).toHaveBeenCalledTimes(3);
      expect(await readdir(directory)).toEqual([]);
    } finally {
      mockRmdir.mockReset().mockImplementation(actualFsPromises.rmdir);
    }

    const nextStorage = await createStorage();
    await expect(lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    await nextStorage.onModuleDestroy();
  });

  it('cleans a file if its read stream is cancelled', async () => {
    const storage = await createStorage();
    const file = await storage.create();
    await file.write(Buffer.from('download'));
    await file.finalize();
    const stream = await file.openReadStream();

    await file.dispose();
    expect(stream.destroyed).toBe(true);
    const [directory] = await instanceDirectories();
    expect(await instanceFiles(directory)).toEqual(['owner.json']);
  });

  it('removes abandoned files only when their owner process is confirmed dead', async () => {
    const deadPid = await deadProcessId();
    const instanceId = randomUUID();
    const abandonedDirectory = join(rootDirectory, instanceId);
    await mkdir(abandonedDirectory, { mode: 0o700 });
    await writeFile(
      join(abandonedDirectory, 'owner.json'),
      await ownerMarker(instanceId, deadPid),
      { mode: 0o600 },
    );
    await writeFile(
      join(abandonedDirectory, `${randomUUID()}.part`),
      'abandoned',
      { mode: 0o600 },
    );

    await createStorage();

    await expect(lstat(abandonedDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('preserves active files belonging to another service instance', async () => {
    const firstStorage = await createStorage();
    const activeFile = await firstStorage.create();
    await activeFile.write(Buffer.from('active'));
    const [activeDirectory] = await instanceDirectories();

    const secondStorage = await createStorage();

    expect(await instanceFiles(activeDirectory)).toHaveLength(2);
    await activeFile.dispose();
    await secondStorage.onModuleDestroy();
  });

  it('preserves another process directory while its owner is alive', async () => {
    const child = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      {
        stdio: 'ignore',
      },
    );
    await once(child, 'spawn');
    if (!child.pid) {
      child.kill();
      throw new Error('The child process did not expose a PID.');
    }

    try {
      const instanceId = randomUUID();
      const activeDirectory = join(rootDirectory, instanceId);
      await mkdir(activeDirectory, { mode: 0o700 });
      await writeFile(
        join(activeDirectory, 'owner.json'),
        await ownerMarker(instanceId, child.pid),
        { mode: 0o600 },
      );
      await writeFile(join(activeDirectory, `${randomUUID()}.part`), 'active', {
        mode: 0o600,
      });

      await createStorage();
      expect(await instanceFiles(activeDirectory)).toHaveLength(2);

      const childExit = once(child, 'exit');
      child.kill();
      await childExit;
      await createStorage();
      await expect(lstat(activeDirectory)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const childExit = once(child, 'exit');
        child.kill();
        await childExit;
      }
    }
  });

  it('preserves an abandoned directory containing a symlink without touching its target', async () => {
    const deadPid = await deadProcessId();
    const instanceId = randomUUID();
    const abandonedDirectory = join(rootDirectory, instanceId);
    const targetPath = join(rootDirectory, 'outside-target');
    await mkdir(abandonedDirectory, { mode: 0o700 });
    await writeFile(
      join(abandonedDirectory, 'owner.json'),
      await ownerMarker(instanceId, deadPid),
      { mode: 0o600 },
    );
    await writeFile(targetPath, 'must remain');

    try {
      await symlink(
        targetPath,
        join(abandonedDirectory, `${randomUUID()}.part`),
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS') {
        return;
      }
      throw error;
    }

    await createStorage();

    await expect(lstat(abandonedDirectory)).resolves.toBeDefined();
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('must remain');
  });

  it('preserves the owner marker after abandoned data removal fails and retries on initialization', async () => {
    const deadPid = await deadProcessId();
    const instanceId = randomUUID();
    const abandonedDirectory = join(rootDirectory, instanceId);
    const partPath = join(abandonedDirectory, `${randomUUID()}.part`);
    await mkdir(abandonedDirectory, { mode: 0o700 });
    await writeFile(
      join(abandonedDirectory, 'owner.json'),
      await ownerMarker(instanceId, deadPid),
      { mode: 0o600 },
    );
    await writeFile(partPath, 'abandoned', { mode: 0o600 });
    const unlinkSpy = mockUnlink.mockImplementation((path: unknown) =>
      String(path) === partPath
        ? Promise.reject(
            Object.assign(new Error('file busy'), { code: 'EBUSY' }),
          )
        : actualFsPromises.unlink(path as string),
    );

    try {
      await createStorage();
      expect(unlinkSpy).toHaveBeenCalledTimes(3);
      await expect(
        lstat(join(abandonedDirectory, 'owner.json')),
      ).resolves.toBeDefined();
      await expect(lstat(partPath)).resolves.toBeDefined();

      mockUnlink.mockReset().mockImplementation(actualFsPromises.unlink);
      await createStorage();
      await expect(lstat(abandonedDirectory)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      mockUnlink.mockReset().mockImplementation(actualFsPromises.unlink);
    }
  });

  it('preserves abandoned files whose names do not match the storage pattern', async () => {
    const deadPid = await deadProcessId();
    const instanceId = randomUUID();
    const directory = join(rootDirectory, instanceId);
    const unexpectedPath = join(directory, 'unexpected.tmp');
    await mkdir(directory, { mode: 0o700 });
    await writeFile(
      join(directory, 'owner.json'),
      await ownerMarker(instanceId, deadPid),
      { mode: 0o600 },
    );
    await writeFile(unexpectedPath, 'must remain', { mode: 0o600 });

    await createStorage();

    await expect(lstat(directory)).resolves.toBeDefined();
    await expect(readFile(unexpectedPath, 'utf8')).resolves.toBe('must remain');
  });

  it('preserves directories whose owner marker cannot be validated', async () => {
    const instanceId = randomUUID();
    const directory = join(rootDirectory, instanceId);
    await mkdir(directory, { mode: 0o700 });
    await writeFile(join(directory, 'owner.json'), 'invalid marker');

    await createStorage();

    await expect(lstat(directory)).resolves.toBeDefined();
  });
});
