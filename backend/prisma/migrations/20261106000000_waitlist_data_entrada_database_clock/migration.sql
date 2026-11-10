ALTER TABLE "ListaEspera"
ALTER COLUMN "dataEntrada"
SET DEFAULT (clock_timestamp() AT TIME ZONE 'UTC');
