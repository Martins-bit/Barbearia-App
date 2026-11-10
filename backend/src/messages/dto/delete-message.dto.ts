import { IsEnum } from 'class-validator';

export enum ModoExclusaoMensagem {
  PARA_MIM = 'PARA_MIM',
  PARA_TODOS = 'PARA_TODOS',
}

export class DeleteMessageDto {
  @IsEnum(ModoExclusaoMensagem, {
    message: 'Modo de exclusão deve ser PARA_MIM ou PARA_TODOS.',
  })
  modo!: ModoExclusaoMensagem;
}
