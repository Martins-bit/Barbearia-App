import { IsEnum } from 'class-validator';
import { CategoriaSolicitacaoTitular } from '../../../generated/prisma/enums';

export class CreatePrivacyRequestDto {
  @IsEnum(CategoriaSolicitacaoTitular)
  categoria!: CategoriaSolicitacaoTitular;
}
