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
  TemporaryExportLimitError,
  TemporaryExportStorageError,
  TemporaryExportStorageService,
} from './temporary-export-storage.service';

const INSTANCE_DIRECTORY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:part|ready)$/;

describe('TemporaryExportStorageService', () => {
  let rootDirectory: string;
  let services: TemporaryExportStorageService[];

  beforeEach(async () => {
    rootDirectory = await mkdtemp(
      join(tmpdir(), 'barbearia-export-storage-test-'),
    );
    services = [];
  });

  afterEach(async () => {
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

  function runCommand(executable: string, args: string[]): Promise<string> {
    return new Promise((resolveOutput, reject) => {
      execFile(
        executable,
        args,
        { encoding: 'utf8', maxBuffer: 16 * 1024, windowsHide: true },
        (error, stdout) => {
          if (error) {
            reject(error);
          } else {
            resolveOutput(stdout);
          }
        },
      );
    });
  }

  async function windowsAclSids(directory: string): Promise<string[]> {
    const encodedPath = Buffer.from(directory, 'utf16le').toString('base64');
    const script = `$path = [System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String('${encodedPath}')); $acl = Get-Acl -LiteralPath $path; $acl.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }`;
    const output = await runCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ]);
    return output.split(/\r?\n/).filter(Boolean).sort();
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
    const identity = await runCommand('whoami.exe', [
      '/user',
      '/fo',
      'csv',
      '/nh',
    ]);
    const serviceSid = identity.match(/"(S-\d+(?:-\d+)+)"/)?.[1];
    expect(serviceSid).toBeDefined();
    const expectedSids = [serviceSid!, 'S-1-5-18', 'S-1-5-32-544'].sort();
    const [partName] = (await instanceFiles(instanceDirectory)).filter((name) =>
      name.endsWith('.part'),
    );

    await expect(windowsAclSids(rootDirectory)).resolves.toEqual(expectedSids);
    await expect(windowsAclSids(instanceDirectory)).resolves.toEqual(
      expectedSids,
    );
    await expect(
      windowsAclSids(join(instanceDirectory, partName)),
    ).resolves.toEqual(expectedSids);
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

  it('removes its files and instance directory on normal module shutdown', async () => {
    const storage = await createStorage();
    const file = await storage.create();
    await file.write(Buffer.from('temporary'));
    const [directory] = await instanceDirectories();

    await storage.onModuleDestroy();

    await expect(lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(rootDirectory)).toEqual([]);
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

  it('preserves directories whose owner marker cannot be validated', async () => {
    const instanceId = randomUUID();
    const directory = join(rootDirectory, instanceId);
    await mkdir(directory, { mode: 0o700 });
    await writeFile(join(directory, 'owner.json'), 'invalid marker');

    await createStorage();

    await expect(lstat(directory)).resolves.toBeDefined();
  });
});
