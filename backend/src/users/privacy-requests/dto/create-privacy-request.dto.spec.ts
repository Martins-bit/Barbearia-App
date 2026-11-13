import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CategoriaSolicitacaoTitular } from '../../../generated/prisma/enums';
import { CreatePrivacyRequestDto } from './create-privacy-request.dto';

describe('CreatePrivacyRequestDto', () => {
  it.each(Object.values(CategoriaSolicitacaoTitular))(
    'accepts the approved category %s',
    async (categoria) => {
      const dto = plainToInstance(CreatePrivacyRequestDto, { categoria });

      await expect(validate(dto)).resolves.toHaveLength(0);
    },
  );

  it('rejects categories outside the approved enum', async () => {
    const dto = plainToInstance(CreatePrivacyRequestDto, {
      categoria: 'PAGAMENTO',
    });

    expect(await validate(dto)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'categoria' }),
      ]),
    );
  });

  it('rejects attempts to provide status, owner, or creation date', async () => {
    const dto = plainToInstance(CreatePrivacyRequestDto, {
      categoria: CategoriaSolicitacaoTitular.CORRECAO,
      titularId: 999,
      status: 'ENCERRADA',
      dataCriacao: new Date().toISOString(),
    });

    expect(
      await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'titularId' }),
        expect.objectContaining({ property: 'status' }),
        expect.objectContaining({ property: 'dataCriacao' }),
      ]),
    );
  });
});
