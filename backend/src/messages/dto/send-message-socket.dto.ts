import { Transform } from 'class-transformer';
import { IsDefined, IsInt, IsString, MaxLength, Min } from 'class-validator';
import { MAX_MESSAGE_LENGTH } from './send-message.dto';

/**
 * Payload do evento WebSocket `message:send` (ETAPA 7C.2).
 *
 * Espelha o `SendMessageDto` do REST para que o conteúdo seja tratado
 * exatamente da mesma forma (trim + 1..500 caracteres).
 *
 * SEGURANÇA: o remetente NUNCA é aceito aqui. A identidade vem exclusivamente
 * de `client.data`, preenchido no handshake JWT. Campos de identidade enviados
 * pelo cliente (`remetenteId`, `remetenteUsuarioId`, `usuarioId`,
 * `tipoUsuario`) fazem a validação falhar, pois a validação do gateway usa
 * `whitelist` + `forbidNonWhitelisted`.
 */
export class SendMessageSocketDto {
  @IsInt()
  @Min(1)
  destinatarioId!: number;

  // `IsDefined` garante rejeição de payload sem o campo: sem ele, `undefined`
  // seria ignorado pelo class-validator e chegaria ao service.
  @IsDefined()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(MAX_MESSAGE_LENGTH)
  conteudo!: string;
}
