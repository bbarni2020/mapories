-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MODERATOR', 'ARTIST', 'USER');

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'PRO', 'TEAM');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActiveAt" TIMESTAMP(3),
    "role" "Role" NOT NULL DEFAULT 'USER',
    "emailHash" TEXT NOT NULL,
    "emailEncrypted" BYTEA NOT NULL,
    "nameEncrypted" BYTEA NOT NULL,
    "passwordHash" TEXT,
    "googleSubHash" TEXT,
    "publicEncryptionKey" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT,
    "tier" "SubscriptionTier" NOT NULL DEFAULT 'FREE',
    "priceCents" INTEGER,
    "isComplimentary" BOOLEAN NOT NULL DEFAULT false,
    "grantedByAdminId" TEXT,
    "grantReason" TEXT,
    "monthlyUploadLimitBytes" BIGINT NOT NULL DEFAULT 1073741824,
    "usedUploadBytes" BIGINT NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),

    CONSTRAINT "UserSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "SubscriptionTier" NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "monthlyUploadLimitBytes" BIGINT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Journal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalMember" (
    "journalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalMember_pkey" PRIMARY KEY ("journalId","userId")
);

-- CreateTable
CREATE TABLE "JournalInvite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "meetingAt" TIMESTAMP(3) NOT NULL,
    "locationName" TEXT NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'AES-256-GCM',
    "visibleAfter" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "blobEncrypted" BYTEA NOT NULL,
    "nonce" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshTokenSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfTokenHash" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "deviceLabel" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedById" TEXT,

    CONSTRAINT "RefreshTokenSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDeviceKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "publicKey" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'X25519',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "UserDeviceKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalKeyEnvelope" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "encryptedKey" BYTEA NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'X25519-XSalsa20-Poly1305',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalKeyEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_emailHash_key" ON "User"("emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSubHash_key" ON "User"("googleSubHash");

-- CreateIndex
CREATE INDEX "UserSubscription_userId_endsAt_idx" ON "UserSubscription"("userId", "endsAt");

-- CreateIndex
CREATE INDEX "UserSubscription_planId_idx" ON "UserSubscription"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_name_key" ON "SubscriptionPlan"("name");

-- CreateIndex
CREATE INDEX "Journal_createdById_idx" ON "Journal"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "JournalInvite_code_key" ON "JournalInvite"("code");

-- CreateIndex
CREATE INDEX "JournalInvite_journalId_idx" ON "JournalInvite"("journalId");

-- CreateIndex
CREATE INDEX "Meeting_journalId_meetingAt_idx" ON "Meeting"("journalId", "meetingAt");

-- CreateIndex
CREATE INDEX "Post_meetingId_visibleAfter_idx" ON "Post"("meetingId", "visibleAfter");

-- CreateIndex
CREATE INDEX "Post_authorId_createdAt_idx" ON "Post"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "MediaAsset_postId_idx" ON "MediaAsset"("postId");

-- CreateIndex
CREATE INDEX "MediaAsset_checksum_idx" ON "MediaAsset"("checksum");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshTokenSession_tokenHash_key" ON "RefreshTokenSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshTokenSession_userId_expiresAt_idx" ON "RefreshTokenSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "RefreshTokenSession_revokedAt_idx" ON "RefreshTokenSession"("revokedAt");

-- CreateIndex
CREATE INDEX "UserDeviceKey_userId_revokedAt_idx" ON "UserDeviceKey"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserDeviceKey_userId_keyVersion_key" ON "UserDeviceKey"("userId", "keyVersion");

-- CreateIndex
CREATE INDEX "JournalKeyEnvelope_recipientUserId_createdAt_idx" ON "JournalKeyEnvelope"("recipientUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JournalKeyEnvelope_journalId_keyVersion_recipientUserId_key" ON "JournalKeyEnvelope"("journalId", "keyVersion", "recipientUserId");

-- AddForeignKey
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalMember" ADD CONSTRAINT "JournalMember_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalMember" ADD CONSTRAINT "JournalMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalInvite" ADD CONSTRAINT "JournalInvite_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshTokenSession" ADD CONSTRAINT "RefreshTokenSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDeviceKey" ADD CONSTRAINT "UserDeviceKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalKeyEnvelope" ADD CONSTRAINT "JournalKeyEnvelope_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalKeyEnvelope" ADD CONSTRAINT "JournalKeyEnvelope_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

