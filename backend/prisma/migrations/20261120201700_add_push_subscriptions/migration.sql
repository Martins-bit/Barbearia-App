CREATE TABLE "PushSubscription" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "endpointCiphertext" BYTEA NOT NULL,
    "endpointNonce" BYTEA NOT NULL,
    "endpointTag" BYTEA NOT NULL,
    "p256dhCiphertext" BYTEA NOT NULL,
    "p256dhNonce" BYTEA NOT NULL,
    "p256dhTag" BYTEA NOT NULL,
    "authCiphertext" BYTEA NOT NULL,
    "authNonce" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "wrappedDataKey" BYTEA NOT NULL,
    "encryptionKeyVersion" TEXT NOT NULL,
    "cryptoFormatVersion" INTEGER NOT NULL,
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataAtualizacao" TIMESTAMP(3) NOT NULL,
    "ultimoUsoEm" TIMESTAMP(3),
    "revogadoEm" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PushSubscriptionFingerprint" (
    "id" SERIAL NOT NULL,
    "subscriptionId" INTEGER NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscriptionFingerprint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PushSubscription_usuarioId_revogadoEm_idx"
    ON "PushSubscription"("usuarioId", "revogadoEm");

CREATE UNIQUE INDEX "PushSubscriptionFingerprint_keyVersion_fingerprint_key"
    ON "PushSubscriptionFingerprint"("keyVersion", "fingerprint");

CREATE UNIQUE INDEX "PushSubscriptionFingerprint_subscriptionId_keyVersion_key"
    ON "PushSubscriptionFingerprint"("subscriptionId", "keyVersion");

ALTER TABLE "PushSubscription"
    ADD CONSTRAINT "PushSubscription_usuarioId_fkey"
    FOREIGN KEY ("usuarioId")
    REFERENCES "Usuario"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

ALTER TABLE "PushSubscriptionFingerprint"
    ADD CONSTRAINT "PushSubscriptionFingerprint_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId")
    REFERENCES "PushSubscription"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
