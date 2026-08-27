import {
  dateKeyFromUtcMidnight,
  formatLocalHHmm,
  getZonedParts,
  isValidDateKey,
  localMinuteOfDay,
  prismaDateFilter,
  weekdayFromDateKey,
  zonedWallTimeToUtc,
} from './tz.util';

describe('tz.util (America/Sao_Paulo)', () => {
  it('converte 09:00 SP de 2026-08-25 para o instante UTC correto', () => {
    const instant = zonedWallTimeToUtc('2026-08-25', '09:00');
    expect(instant.getTime()).toBe(Date.UTC(2026, 7, 25, 12, 0, 0));
  });

  it('round-trip: instante volta exatamente para o HH:mm local original', () => {
    const cases = ['00:00', '09:00', '14:07', '23:59'];
    for (const hhmm of cases) {
      const instant = zonedWallTimeToUtc('2026-08-25', hhmm);
      expect(formatLocalHHmm(instant)).toBe(hhmm);
    }
  });

  it('resolve o offset por DATA via Intl em período histórico de DST brasileiro', () => {
    // 16/02/2019 ainda estava em horário de verão (UTC-2).
    const duringDst = zonedWallTimeToUtc('2019-02-16', '20:00');
    expect(duringDst.toISOString()).toBe('2019-02-16T22:00:00.000Z');

    // 17/02/2019 já voltou ao padrão (UTC-3).
    const afterDst = zonedWallTimeToUtc('2019-02-17', '20:00');
    expect(afterDst.toISOString()).toBe('2019-02-17T23:00:00.000Z');

    // Entre as duas meias-noites locais houve a "hora extra" da transição.
    expect(afterDst.getTime() - duringDst.getTime()).toBe(
      25 * 60 * 60 * 1000,
    );
  });

  it('getZonedParts devolve os componentes locais do fuso da barbearia', () => {
    const parts = getZonedParts(new Date(Date.UTC(2026, 7, 25, 12, 30)));
    expect(parts).toEqual({
      year: 2026,
      month: 8,
      day: 25,
      hour: 9,
      minute: 30,
    });
  });

  it('localMinuteOfDay converte instantes para minutos locais', () => {
    expect(localMinuteOfDay(zonedWallTimeToUtc('2026-08-25', '10:45'))).toBe(
      645,
    );
    expect(localMinuteOfDay(zonedWallTimeToUtc('2026-08-25', '00:00'))).toBe(0);
  });

  it('weekdayFromDateKey usa calendário puro (sem fuso envolvido)', () => {
    expect(weekdayFromDateKey('2026-08-25')).toBe(2); // terça
    expect(weekdayFromDateKey('2099-01-05')).toBe(1); // segunda
    expect(weekdayFromDateKey('2099-01-10')).toBe(6); // sábado
    expect(weekdayFromDateKey('2099-01-11')).toBe(0); // domingo
  });

  it('isValidDateKey rejeita datas inexistentes do calendário', () => {
    expect(isValidDateKey('2026-08-25')).toBe(true);
    expect(isValidDateKey('2024-02-29')).toBe(true); // bissexto
    expect(isValidDateKey('2026-02-29')).toBe(false);
    expect(isValidDateKey('2026-13-01')).toBe(false);
    expect(isValidDateKey('2026-00-10')).toBe(false);
    expect(isValidDateKey('não-é-data')).toBe(false);
  });

  it('prismaDateFilter e dateKeyFromUtcMidnight são inversos (coluna @db.Date)', () => {
    const filter = prismaDateFilter('2099-01-12');
    expect(filter.toISOString()).toBe('2099-01-12T00:00:00.000Z');
    expect(dateKeyFromUtcMidnight(filter)).toBe('2099-01-12');
  });
});
