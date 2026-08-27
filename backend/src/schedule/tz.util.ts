/**
 * Utilitários de fuso horário da agenda.
 *
 * A barbearia opera no fuso America/Sao_Paulo. Todo horário de entrada da API
 * é horário LOCAL ("HH:mm" + data "YYYY-MM-DD") e é convertido para instante
 * real (Date em UTC) via Intl, SEM presumir offset fixo: o offset é resolvido
 * para a data consultada (inclusive para datas históricas com horário de
 * verão brasileiro).
 */

export const SCHEDULE_TIMEZONE = 'America/Sao_Paulo';

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const zonedPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SCHEDULE_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Partes de calendário do instante no fuso da barbearia. */
export function getZonedParts(instant: Date): ZonedParts {
  const parts = zonedPartsFormatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((item) => item.type === type);
    return Number(part ? part.value : '0');
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
  };
}

/**
 * Converte um horário LOCAL da barbearia (data + HH:mm) no instante real (UTC).
 * Técnica: interpreta como UTC (palpite inicial), mede o offset REAL da zona
 * naquele instante via Intl e corrige UMA vez; se após a correção o relógio
 * local ainda não bater com o solicitado (caso raro de transição de fuso),
 * aplica uma segunda correção de verificação. Para offsets estáveis a primeira
 * passada já é exata — nunca há dupla aplicação de offset.
 *
 * Observação: horários LOCAIS inexistentes (gap de transição de DST) resolvem
 * de forma determinística para um instante próximo da transição. Hoje o
 * America/Sao_Paulo não possui DST, então a conversão é exata.
 */
export function zonedWallTimeToUtc(dateKey: string, hhmm: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = hhmm.split(':').map(Number);

  const requestedAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const wallOf = (instantMs: number): number => {
    const parts = getZonedParts(new Date(instantMs));
    return Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0,
      0,
    );
  };

  // Palpite inicial trata o horário local como se fosse UTC.
  let guessMs = requestedAsUtc;

  // Correção 1: subtrai o offset real medido no palpite.
  guessMs = requestedAsUtc - (wallOf(guessMs) - requestedAsUtc);

  // Correção 2 (verificação): só aplica se ainda divergiu (transição de fuso).
  if (wallOf(guessMs) !== requestedAsUtc) {
    guessMs -= wallOf(guessMs) - requestedAsUtc;
  }

  return new Date(guessMs);
}

/** Minuto do dia local (0..1439) de um instante, no fuso da barbearia. */
export function localMinuteOfDay(instant: Date): number {
  const { hour, minute } = getZonedParts(instant);
  return hour * 60 + minute;
}

/** Instante → "HH:mm" local da barbearia (round-trip de zonedWallTimeToUtc). */
export function formatLocalHHmm(instant: Date): string {
  const { hour, minute } = getZonedParts(instant);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(hour)}:${pad(minute)}`;
}

/** "YYYY-MM-DD" → dia da semana local (0=domingo .. 6=sábado), calendário puro. */
export function weekdayFromDateKey(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Valida se "YYYY-MM-DD" representa uma data real do calendário (ex.: rejeita 02-30). */
export function isValidDateKey(dateKey: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const asUtc = new Date(Date.UTC(year, month - 1, day));

  return (
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() === month - 1 &&
    asUtc.getUTCDate() === day
  );
}

/**
 * Filtro canônico para colunas Prisma @db.Date: a data civil é representada
 * na meia-noite UTC. Isso NÃO é um horário de São Paulo — é o contrato da
 * coluna DATE (dia civil), independente de fuso.
 */
export function prismaDateFilter(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

/** Inverso de prismaDateFilter: instante de coluna @db.Date → "YYYY-MM-DD". */
export function dateKeyFromUtcMidnight(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}
