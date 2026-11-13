import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserDto } from './update-user.dto';

describe('UpdateUserDto', () => {
  it.each([
    ['  Maria', 'Maria'],
    ['Maria  ', 'Maria'],
  ])('trims a name with surrounding spaces: %s', async (input, expected) => {
    const dto = plainToInstance(UpdateUserDto, { nome: input });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.nome).toBe(expected);
  });

  it('rejects a name made only of spaces after trimming', async () => {
    const dto = plainToInstance(UpdateUserDto, { nome: '   ' });

    expect(await validate(dto)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'nome' })]),
    );
    expect(dto.nome).toBe('');
  });
});
