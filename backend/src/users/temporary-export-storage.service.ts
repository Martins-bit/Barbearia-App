import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import {
  close as closeCallback,
  constants as fsConstants,
  createReadStream,
  fstat as fstatCallback,
  open as openCallback,
  type Dirent,
  type Stats,
} from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readlink,
  readdir,
  rmdir,
  unlink,
  link,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { Readable } from 'node:stream';

export const TEMPORARY_EXPORT_STORAGE_OPTIONS =
  'TEMPORARY_EXPORT_STORAGE_OPTIONS';

const OWNER_FILE = 'owner.json';
const FILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:part|ready)$/;
const WRITE_CHUNK_BYTES = 64 * 1024;

/**
 * Provisional defaults only. Calibrate against production disk capacity and
 * load tests before treating either value as an operational limit.
 */
export const DEFAULT_TEMPORARY_EXPORT_MAX_FILE_BYTES = 256 * 1024 * 1024;
export const DEFAULT_TEMPORARY_EXPORT_MAX_TOTAL_BYTES = 512 * 1024 * 1024;

export interface TemporaryExportStorageOptions {
  rootDirectory?: string;
  maxFileSizeBytes?: number;
  maxTotalSizeBytes?: number;
}

export interface TemporaryExportFile {
  write(chunk: Uint8Array): Promise<void>;
  finalize(): Promise<void>;
  openReadStream(): Promise<Readable>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

export class TemporaryExportStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = TemporaryExportStorageError.name;
  }
}

export class TemporaryExportLimitError extends TemporaryExportStorageError {
  constructor(message: string) {
    super(message);
    this.name = TemporaryExportLimitError.name;
  }
}

export class TemporaryExportCancelledError extends TemporaryExportStorageError {
  constructor() {
    super('A geração do arquivo temporário foi cancelada.');
    this.name = TemporaryExportCancelledError.name;
  }
}

interface ManagedFile {
  readonly id: string;
  readonly partPath: string;
  readonly readyPath: string;
  readonly abortController: AbortController;
  readonly streams: Set<Readable>;
  state: 'writing' | 'finalizing' | 'ready' | 'disposing' | 'disposed';
  writeClosing: boolean;
  readerOpened: boolean;
  reservedBytes: number;
  writeQueue: Promise<void>;
  writeFailure?: unknown;
  writer?: Awaited<ReturnType<typeof open>>;
  cleanupPromise?: Promise<void>;
  externalAbortSignal?: AbortSignal;
  externalAbortHandler?: () => void;
}

interface OwnerMarker {
  pid: number;
  instanceId: string;
  hostname: string;
  pidNamespace?: string;
}

@Injectable()
export class TemporaryExportStorageService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TemporaryExportStorageService.name);
  private readonly rootDirectory: string;
  private readonly maxFileSizeBytes: number;
  private readonly maxTotalSizeBytes: number;
  private readonly files = new Map<string, ManagedFile>();
  private currentWindowsSid?: string;
  private instanceDirectory?: string;
  private instanceId?: string;
  private pidNamespace?: string;
  private initialized = false;
  private shuttingDown = false;
  private initializationPromise?: Promise<void>;
  private allocatedBytes = 0;

  constructor(
    @Optional()
    @Inject(TEMPORARY_EXPORT_STORAGE_OPTIONS)
    options: TemporaryExportStorageOptions = {},
  ) {
    this.rootDirectory = resolve(
      options.rootDirectory ??
        join(tmpdir(), 'barbearia-app-personal-data-exports'),
    );
    this.maxFileSizeBytes =
      options.maxFileSizeBytes ?? DEFAULT_TEMPORARY_EXPORT_MAX_FILE_BYTES;
    this.maxTotalSizeBytes =
      options.maxTotalSizeBytes ?? DEFAULT_TEMPORARY_EXPORT_MAX_TOTAL_BYTES;

    if (
      !Number.isSafeInteger(this.maxFileSizeBytes) ||
      this.maxFileSizeBytes <= 0 ||
      !Number.isSafeInteger(this.maxTotalSizeBytes) ||
      this.maxTotalSizeBytes <= 0
    ) {
      throw new Error('Os limites do armazenamento temporário são inválidos.');
    }
  }

  async onModuleInit(): Promise<void> {
    await this.ensureInitialized();
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
    if (!this.instanceDirectory || !this.instanceId) {
      return;
    }

    let cleanupFailures = 0;
    for (const file of this.files.values()) {
      try {
        await this.cleanupFile(file);
      } catch {
        cleanupFailures += 1;
        this.logger.warn(
          'Não foi possível remover um arquivo temporário durante o encerramento.',
        );
      }
    }

    if (cleanupFailures > 0) {
      throw new TemporaryExportStorageError(
        'Não foi possível limpar todos os arquivos temporários no encerramento.',
      );
    }

    try {
      await this.removeRegularFile(join(this.instanceDirectory, OWNER_FILE));
      await rmdir(this.instanceDirectory);
      this.instanceDirectory = undefined;
      this.instanceId = undefined;
    } catch {
      this.logger.warn(
        'O diretório temporário da instância foi preservado para limpeza posterior.',
      );
      throw new TemporaryExportStorageError(
        'Não foi possível limpar o diretório temporário no encerramento.',
      );
    }
  }

  async create(signal?: AbortSignal): Promise<TemporaryExportFile> {
    await this.ensureInitialized();
    if (this.shuttingDown || !this.instanceDirectory) {
      throw new TemporaryExportStorageError(
        'O armazenamento temporário está encerrando.',
      );
    }
    if (signal?.aborted) {
      throw new TemporaryExportCancelledError();
    }

    const id = randomUUID();
    const partPath = join(this.instanceDirectory, `${id}.part`);
    const readyPath = join(this.instanceDirectory, `${id}.ready`);
    let writer: Awaited<ReturnType<typeof open>>;
    try {
      writer = await open(partPath, 'wx', 0o600);
    } catch {
      throw new TemporaryExportStorageError(
        'Não foi possível criar o arquivo temporário.',
      );
    }

    const file: ManagedFile = {
      id,
      partPath,
      readyPath,
      abortController: new AbortController(),
      streams: new Set(),
      state: 'writing',
      writeClosing: false,
      readerOpened: false,
      reservedBytes: 0,
      writeQueue: Promise.resolve(),
      writer,
      externalAbortSignal: signal,
    };
    this.files.set(id, file);

    if (signal) {
      file.externalAbortHandler = () => {
        void this.cancelFile(file).catch(() => {
          this.logger.warn(
            'Não foi possível limpar um arquivo temporário cancelado.',
          );
        });
      };
      signal.addEventListener('abort', file.externalAbortHandler, {
        once: true,
      });
      if (signal.aborted) {
        await this.cancelFile(file);
        throw new TemporaryExportCancelledError();
      }
    }

    return {
      write: (chunk) => this.write(file, chunk),
      finalize: () => this.finalize(file),
      openReadStream: () => this.openReadStream(file),
      cancel: () => this.cancelFile(file),
      dispose: () => this.cleanupFile(file),
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initializationPromise ??= this.initialize();
    await this.initializationPromise;
  }

  private async initialize(): Promise<void> {
    await this.ensurePrivateDirectory(this.rootDirectory);
    this.pidNamespace = await this.readPidNamespace();
    await this.cleanupAbandonedDirectories();

    const instanceId = randomUUID();
    const instanceDirectory = join(this.rootDirectory, instanceId);
    try {
      await mkdir(instanceDirectory, { mode: 0o700 });
      await this.applyPrivatePermissions(instanceDirectory);
      await this.writeOwnerMarker(instanceDirectory, {
        pid: process.pid,
        instanceId,
        hostname: hostname(),
        pidNamespace: this.pidNamespace,
      });
    } catch {
      try {
        await rmdir(instanceDirectory);
      } catch {
        this.logger.warn(
          'Não foi possível remover um diretório temporário parcialmente inicializado.',
        );
      }
      throw new TemporaryExportStorageError(
        'Não foi possível inicializar o armazenamento temporário.',
      );
    }

    this.instanceId = instanceId;
    this.instanceDirectory = instanceDirectory;
    this.initialized = true;
  }

  private async ensurePrivateDirectory(directory: string): Promise<void> {
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error('invalid directory');
      }
      await this.applyPrivatePermissions(directory);
    } catch {
      throw new TemporaryExportStorageError(
        'O diretório privado de arquivos temporários não está disponível.',
      );
    }
  }

  private async applyPrivatePermissions(directory: string): Promise<void> {
    if (process.platform === 'win32') {
      await this.applyWindowsPrivateAcl(directory);
      return;
    }
    await chmod(directory, 0o700);
    const info = await lstat(directory);
    if ((info.mode & 0o777) !== 0o700) {
      throw new Error('insecure directory permissions');
    }
  }

  private async applyWindowsPrivateAcl(directory: string): Promise<void> {
    try {
      this.currentWindowsSid ??= await this.readWindowsUserSid();
      const icacls = this.windowsSystemExecutable('icacls.exe');
      await this.runWindowsCommand(icacls, [directory, '/reset']);
      await this.runWindowsCommand(icacls, [directory, '/inheritance:r']);
      await this.runWindowsCommand(icacls, [
        directory,
        '/grant:r',
        `*${this.currentWindowsSid}:(OI)(CI)F`,
        '*S-1-5-18:(OI)(CI)F',
        '*S-1-5-32-544:(OI)(CI)F',
      ]);
      await this.runWindowsCommand(icacls, [directory, '/verify']);
    } catch {
      throw new TemporaryExportStorageError(
        'Não foi possível restringir as permissões do diretório temporário no Windows.',
      );
    }
  }

  private async readWindowsUserSid(): Promise<string> {
    const output = await this.runWindowsCommand(
      this.windowsSystemExecutable('whoami.exe'),
      ['/user', '/fo', 'csv', '/nh'],
    );
    const sid = output.match(/"(S-\d+(?:-\d+)+)"/)?.[1];
    if (!sid) {
      throw new Error('The current Windows user SID could not be resolved.');
    }
    return sid;
  }

  private windowsSystemExecutable(name: string): string {
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot || !/^[a-zA-Z]:\\/.test(systemRoot)) {
      throw new Error('SystemRoot is not a valid absolute Windows path.');
    }
    return join(systemRoot, 'System32', name);
  }

  private runWindowsCommand(
    executable: string,
    args: string[],
  ): Promise<string> {
    return new Promise((resolveOutput, reject) => {
      execFile(
        executable,
        args,
        {
          encoding: 'utf8',
          maxBuffer: 16 * 1024,
          timeout: 10_000,
          windowsHide: true,
        },
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

  private async writeOwnerMarker(
    directory: string,
    marker: OwnerMarker,
  ): Promise<void> {
    const markerPath = join(directory, OWNER_FILE);
    const markerFile = await open(markerPath, 'wx', 0o600);
    try {
      await markerFile.writeFile(JSON.stringify(marker), 'utf8');
      await markerFile.sync();
    } finally {
      await markerFile.close();
    }
  }

  private async cleanupAbandonedDirectories(): Promise<void> {
    const entries = await readdir(this.rootDirectory, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        !FILE_ID_PATTERN.test(entry.name)
      ) {
        this.logger.warn(
          'Uma entrada desconhecida no armazenamento temporário foi preservada.',
        );
        continue;
      }

      const directory = join(this.rootDirectory, entry.name);
      const owner = await this.readOwnerMarker(directory, entry.name);
      if (!owner) {
        this.logger.warn(
          'Um diretório temporário sem identificação confiável foi preservado.',
        );
        continue;
      }

      if (
        owner.hostname !== hostname() ||
        (process.platform === 'linux' &&
          (!owner.pidNamespace ||
            !this.pidNamespace ||
            owner.pidNamespace !== this.pidNamespace))
      ) {
        this.logger.warn(
          'A identidade do processo proprietário não pôde ser confirmada; o diretório foi preservado.',
        );
        continue;
      }

      const status = this.processStatus(owner.pid);
      if (status === 'alive') {
        continue;
      }
      if (status === 'unknown') {
        this.logger.warn(
          'O estado do processo proprietário não pôde ser confirmado; o diretório foi preservado.',
        );
        continue;
      }

      if (!(await this.removeAbandonedDirectory(directory))) {
        this.logger.warn(
          'Um diretório temporário abandonado não pôde ser confirmado como seguro para remoção e foi preservado.',
        );
      }
    }
  }

  private async readOwnerMarker(
    directory: string,
    directoryId: string,
  ): Promise<OwnerMarker | null> {
    const markerPath = join(directory, OWNER_FILE);
    let markerFile: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const markerInfo = await lstat(markerPath);
      if (
        !markerInfo.isFile() ||
        markerInfo.isSymbolicLink() ||
        markerInfo.size > 256
      ) {
        return null;
      }
      markerFile = await open(
        markerPath,
        fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
      );
      const openedInfo = await markerFile.stat();
      if (!openedInfo.isFile() || openedInfo.size > 256) {
        return null;
      }
      const marker = JSON.parse(await markerFile.readFile('utf8')) as unknown;
      if (
        !marker ||
        typeof marker !== 'object' ||
        !('pid' in marker) ||
        !('instanceId' in marker) ||
        !('hostname' in marker)
      ) {
        return null;
      }
      const candidate = marker as Partial<OwnerMarker>;
      if (
        !Number.isSafeInteger(candidate.pid) ||
        (candidate.pid ?? 0) <= 0 ||
        candidate.instanceId !== directoryId ||
        typeof candidate.hostname !== 'string' ||
        (candidate.pidNamespace !== undefined &&
          typeof candidate.pidNamespace !== 'string')
      ) {
        return null;
      }
      return {
        pid: candidate.pid!,
        instanceId: candidate.instanceId,
        hostname: candidate.hostname,
        pidNamespace: candidate.pidNamespace,
      };
    } catch {
      return null;
    } finally {
      await markerFile?.close().catch(() => {
        this.logger.warn(
          'Não foi possível fechar o marcador de um diretório temporário.',
        );
      });
    }
  }

  private async readPidNamespace(): Promise<string | undefined> {
    if (process.platform !== 'linux') {
      return undefined;
    }
    try {
      return await readlink('/proc/self/ns/pid');
    } catch {
      return undefined;
    }
  }

  private processStatus(pid: number): 'alive' | 'dead' | 'unknown' {
    try {
      process.kill(pid, 0);
      return 'alive';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') {
        return 'dead';
      }
      if (code === 'EPERM') {
        return 'alive';
      }
      return 'unknown';
    }
  }

  private async removeAbandonedDirectory(directory: string): Promise<boolean> {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return false;
    }

    const removable: string[] = [];
    for (const entry of entries) {
      if (
        entry.isSymbolicLink() ||
        (entry.name !== OWNER_FILE && !FILE_NAME_PATTERN.test(entry.name))
      ) {
        return false;
      }
      const filePath = join(directory, entry.name);
      try {
        const info = await lstat(filePath);
        if (!info.isFile() || info.isSymbolicLink()) {
          return false;
        }
      } catch {
        return false;
      }
      removable.push(filePath);
    }

    try {
      for (const filePath of removable) {
        await unlink(filePath);
      }
      await rmdir(directory);
      return true;
    } catch {
      return false;
    }
  }

  private write(file: ManagedFile, chunk: Uint8Array): Promise<void> {
    if (!(chunk instanceof Uint8Array)) {
      return this.failWrite(
        file,
        new TemporaryExportStorageError(
          'O conteúdo do arquivo temporário deve ser binário.',
        ),
      );
    }
    if (file.state !== 'writing' || file.writeClosing || this.shuttingDown) {
      return Promise.reject(
        new TemporaryExportStorageError(
          'O arquivo temporário não aceita mais gravações.',
        ),
      );
    }

    const operation = file.writeQueue.then(() => this.writeChunk(file, chunk));
    file.writeQueue = operation.then(
      () => undefined,
      (error: unknown) => {
        file.writeFailure = error;
      },
    );
    return operation;
  }

  private async writeChunk(
    file: ManagedFile,
    chunk: Uint8Array,
  ): Promise<void> {
    try {
      this.assertWritable(file);
      const nextFileSize = file.reservedBytes + chunk.byteLength;
      if (nextFileSize > this.maxFileSizeBytes) {
        throw new TemporaryExportLimitError(
          'O arquivo temporário excedeu o limite de tamanho.',
        );
      }
      if (this.allocatedBytes + chunk.byteLength > this.maxTotalSizeBytes) {
        throw new TemporaryExportLimitError(
          'A quota total do armazenamento temporário foi excedida.',
        );
      }

      this.allocatedBytes += chunk.byteLength;
      file.reservedBytes = nextFileSize;
      let offset = 0;
      while (offset < chunk.byteLength) {
        this.assertWritable(file);
        const end = Math.min(offset + WRITE_CHUNK_BYTES, chunk.byteLength);
        const result = await file.writer!.write(
          chunk,
          offset,
          end - offset,
          null,
        );
        if (result.bytesWritten <= 0) {
          throw new Error('write returned no progress');
        }
        offset += result.bytesWritten;
        await yieldToEventLoop();
      }
    } catch (error) {
      await this.cleanupFile(file, false).catch(() => {
        this.logger.warn(
          'Não foi possível limpar um arquivo após falha de escrita.',
        );
      });
      if (
        error instanceof TemporaryExportStorageError ||
        error instanceof TemporaryExportLimitError
      ) {
        throw error;
      }
      throw new TemporaryExportStorageError(
        'Não foi possível gravar o arquivo temporário.',
      );
    }
  }

  private assertWritable(file: ManagedFile): void {
    if (
      file.state !== 'writing' ||
      file.abortController.signal.aborted ||
      this.shuttingDown
    ) {
      throw new TemporaryExportCancelledError();
    }
  }

  private async failWrite(
    file: ManagedFile,
    error: TemporaryExportStorageError,
  ): Promise<void> {
    await this.cancelFile(file).catch(() => {
      this.logger.warn(
        'Não foi possível limpar um arquivo após uma gravação inválida.',
      );
    });
    throw error;
  }

  private async finalize(file: ManagedFile): Promise<void> {
    if (file.state === 'ready') {
      return;
    }
    if (file.state !== 'writing' || file.writeClosing) {
      throw new TemporaryExportStorageError(
        'O arquivo temporário não pode ser finalizado.',
      );
    }

    file.writeClosing = true;
    try {
      await file.writeQueue;
      if (file.writeFailure) {
        throw new TemporaryExportStorageError(
          'Uma gravação anterior do arquivo temporário falhou.',
        );
      }
      if (file.state !== 'writing') {
        throw new TemporaryExportCancelledError();
      }

      file.state = 'finalizing';
      await file.writer!.sync();
      await file.writer!.close();
      file.writer = undefined;
      await link(file.partPath, file.readyPath);
      await unlink(file.partPath);
      file.state = 'ready';
    } catch (error) {
      await this.cleanupFile(file, false).catch(() => {
        this.logger.warn(
          'Não foi possível limpar um arquivo após falha de finalização.',
        );
      });
      if (error instanceof TemporaryExportStorageError) {
        throw error;
      }
      throw new TemporaryExportStorageError(
        'Não foi possível finalizar o arquivo temporário.',
      );
    }
  }

  private async openReadStream(file: ManagedFile): Promise<Readable> {
    if (file.state !== 'ready') {
      throw new TemporaryExportStorageError(
        'O arquivo temporário só pode ser lido após a finalização.',
      );
    }
    if (file.readerOpened) {
      throw new TemporaryExportStorageError(
        'O arquivo temporário já foi aberto para leitura.',
      );
    }
    file.readerOpened = true;

    let fd: number | undefined;
    try {
      fd = await new Promise<number>((resolveFd, reject) => {
        openCallback(
          file.readyPath,
          fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
          (error, openedFd) => {
            if (error) {
              reject(error);
            } else {
              resolveFd(openedFd);
            }
          },
        );
      });
      const info = await new Promise<Stats>((resolveStat, reject) => {
        fstatCallback(fd!, (error, stat) => {
          if (error) {
            reject(error);
          } else {
            resolveStat(stat);
          }
        });
      });
      if (
        !info.isFile() ||
        info.size !== file.reservedBytes ||
        info.size > this.maxFileSizeBytes
      ) {
        throw new Error('invalid finalized file');
      }
      if (file.state !== 'ready') {
        throw new TemporaryExportCancelledError();
      }

      const stream = createReadStream(file.readyPath, {
        fd,
        autoClose: true,
      });
      fd = undefined;
      file.streams.add(stream);
      stream.once('error', () => {
        this.logger.warn('Ocorreu uma falha ao ler um arquivo temporário.');
      });
      stream.once('close', () => {
        file.streams.delete(stream);
        void this.cleanupFile(file).catch(() => {
          this.logger.warn(
            'Não foi possível remover um arquivo após a leitura.',
          );
        });
      });
      return stream;
    } catch {
      if (fd !== undefined) {
        await new Promise<void>((resolveClose) => {
          closeCallback(fd!, () => resolveClose());
        });
      }
      await this.cleanupFile(file).catch(() => {
        this.logger.warn(
          'Não foi possível limpar um arquivo após falha de leitura.',
        );
      });
      throw new TemporaryExportStorageError(
        'Não foi possível abrir o arquivo temporário para leitura.',
      );
    }
  }

  private async cancelFile(file: ManagedFile): Promise<void> {
    if (file.state === 'disposed') {
      return;
    }
    file.state = 'disposing';
    file.writeClosing = true;
    file.abortController.abort();
    await this.cleanupFile(file);
  }

  private async cleanupFile(
    file: ManagedFile,
    waitForWrites = true,
  ): Promise<void> {
    if (file.state === 'disposed') {
      return;
    }
    if (waitForWrites) {
      file.state = 'disposing';
      file.writeClosing = true;
      file.abortController.abort();
      await file.writeQueue;
      return this.cleanupFile(file, false);
    }
    if (file.cleanupPromise) {
      return file.cleanupPromise;
    }

    file.state = 'disposing';
    file.writeClosing = true;
    file.abortController.abort();
    file.externalAbortSignal?.removeEventListener(
      'abort',
      file.externalAbortHandler!,
    );

    const cleanup = (async () => {
      if (waitForWrites) {
        await file.writeQueue;
      }
      for (const stream of file.streams) {
        if (!stream.closed) {
          const closed = new Promise<void>((resolveClose) => {
            stream.once('close', () => resolveClose());
          });
          if (!stream.destroyed) {
            stream.destroy();
          }
          await closed;
        }
      }
      if (file.writer) {
        await file.writer.close();
        file.writer = undefined;
      }
      await this.removeRegularFile(file.partPath);
      await this.removeRegularFile(file.readyPath);
      this.allocatedBytes -= file.reservedBytes;
      file.reservedBytes = 0;
      file.state = 'disposed';
      this.files.delete(file.id);
    })();
    file.cleanupPromise = cleanup;
    try {
      await cleanup;
    } catch {
      file.cleanupPromise = undefined;
      this.logger.warn(
        'Um arquivo temporário foi preservado porque sua remoção não pôde ser confirmada.',
      );
      throw new TemporaryExportStorageError(
        'Não foi possível remover o arquivo temporário.',
      );
    }
  }

  private async removeRegularFile(filePath: string): Promise<void> {
    try {
      const info = await lstat(filePath);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error('refusing to remove non-regular file');
      }
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }
}
