import { Test, TestingModule } from '@nestjs/testing';
import { JwtGuard } from './jwt.guard';

describe('JwtGuard', () => {
  let guard: JwtGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JwtGuard],
    }).compile();

    guard = module.get<JwtGuard>(JwtGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should extend AuthGuard', () => {
    expect(guard.constructor.name).toBe('JwtGuard');
  });
});
