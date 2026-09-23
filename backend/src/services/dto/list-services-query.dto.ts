import { IsInt, Min } from 'class-validator';

/**
 * Filtro de listagem de serviços (decisão de projeto: serviços pertencem a um
 * barbeiro). O `barbeiroId` é OBRIGATÓRIO — não existe catálogo global.
 *
 * Fluxo do frontend: cliente escolhe o barbeiro → recebe os serviços ativos
 * daquele barbeiro → escolhe o serviço → consulta disponibilidade.
 */
export class ListServicesQueryDto {
  @IsInt()
  @Min(1)
  barbeiroId!: number;
}
