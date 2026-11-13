import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  CategoriaSolicitacaoTitular,
  StatusSolicitacaoTitular,
} from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePrivacyRequestDto } from './dto/create-privacy-request.dto';
import { ListPrivacyRequestsQueryDto } from './dto/list-privacy-requests-query.dto';

const privacyRequestSelect = {
  id: true,
  categoria: true,
  status: true,
  dataCriacao: true,
} as const;

export interface PrivacyRequestResponse {
  id: number;
  categoria: CategoriaSolicitacaoTitular;
  status: StatusSolicitacaoTitular;
  dataCriacao: string;
}

export interface PrivacyRequestPage {
  solicitacoes: PrivacyRequestResponse[];
  proximoCursor: number | null;
}

@Injectable()
export class PrivacyRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    titularId: number,
    dto: CreatePrivacyRequestDto,
    idempotencyKey: string,
  ): Promise<PrivacyRequestResponse> {
    const where = {
      titularId,
      chaveIdempotencia: idempotencyKey,
    };
    const existing = await this.prisma.solicitacaoTitular.findFirst({
      where,
      select: privacyRequestSelect,
    });

    if (existing) {
      return this.resolveIdempotentRequest(existing, dto.categoria);
    }

    try {
      const created = await this.prisma.solicitacaoTitular.create({
        data: {
          titularId,
          chaveIdempotencia: idempotencyKey,
          categoria: dto.categoria,
        },
        select: privacyRequestSelect,
      });

      return this.toResponse(created);
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }

      const concurrentRequest = await this.prisma.solicitacaoTitular.findFirst({
        where,
        select: privacyRequestSelect,
      });
      if (!concurrentRequest) {
        throw error;
      }

      return this.resolveIdempotentRequest(concurrentRequest, dto.categoria);
    }
  }

  async findMine(
    titularId: number,
    query: ListPrivacyRequestsQueryDto,
  ): Promise<PrivacyRequestPage> {
    const limit = query.limit ?? 20;
    let olderThan: Prisma.SolicitacaoTitularWhereInput | undefined;

    if (query.cursor !== undefined) {
      const cursorRequest = await this.prisma.solicitacaoTitular.findFirst({
        where: { id: query.cursor, titularId },
        select: { id: true, dataCriacao: true },
      });

      if (!cursorRequest) {
        throw new BadRequestException('Cursor de solicitação inválido.');
      }

      olderThan = {
        OR: [
          { dataCriacao: { lt: cursorRequest.dataCriacao } },
          {
            dataCriacao: cursorRequest.dataCriacao,
            id: { lt: cursorRequest.id },
          },
        ],
      };
    }

    const rows = await this.prisma.solicitacaoTitular.findMany({
      where: olderThan ? { titularId, AND: [olderThan] } : { titularId },
      orderBy: [{ dataCriacao: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: privacyRequestSelect,
    });
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    return {
      solicitacoes: pageRows.map((row) => this.toResponse(row)),
      proximoCursor: hasMore
        ? (pageRows[pageRows.length - 1]?.id ?? null)
        : null,
    };
  }

  private resolveIdempotentRequest(
    request: {
      id: number;
      categoria: CategoriaSolicitacaoTitular;
      status: StatusSolicitacaoTitular;
      dataCriacao: Date;
    },
    requestedCategory: CategoriaSolicitacaoTitular,
  ): PrivacyRequestResponse {
    if (request.categoria !== requestedCategory) {
      throw new ConflictException(
        'A chave de idempotência já foi usada com outra categoria.',
      );
    }

    return this.toResponse(request);
  }

  private toResponse(request: {
    id: number;
    categoria: CategoriaSolicitacaoTitular;
    status: StatusSolicitacaoTitular;
    dataCriacao: Date;
  }): PrivacyRequestResponse {
    return {
      id: request.id,
      categoria: request.categoria,
      status: request.status,
      dataCriacao: request.dataCriacao.toISOString(),
    };
  }
}
