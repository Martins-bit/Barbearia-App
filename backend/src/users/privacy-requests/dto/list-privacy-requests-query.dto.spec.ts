import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListPrivacyRequestsQueryDto } from './list-privacy-requests-query.dto';

describe('ListPrivacyRequestsQueryDto', () => {
  it('converts bounded pagination parameters to numbers', async () => {
    const dto = plainToInstance(ListPrivacyRequestsQueryDto, {
      cursor: '21',
      limit: '50',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto).toEqual({ cursor: 21, limit: 50 });
  });

  it.each([
    [{ limit: '0' }],
    [{ limit: '101' }],
    [{ cursor: '-1' }],
    [{ cursor: 'not-a-number' }],
  ])('rejects invalid pagination input: %j', async (input) => {
    const dto = plainToInstance(ListPrivacyRequestsQueryDto, input);

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
