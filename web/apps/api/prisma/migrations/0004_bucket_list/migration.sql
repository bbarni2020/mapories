-- CreateTable
CREATE TABLE "BucketListItem" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "locationName" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BucketListItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BucketListItem_journalId_isCompleted_createdAt_idx" ON "BucketListItem"("journalId", "isCompleted", "createdAt");

-- CreateIndex
CREATE INDEX "BucketListItem_completedById_completedAt_idx" ON "BucketListItem"("completedById", "completedAt");

-- AddForeignKey
ALTER TABLE "BucketListItem" ADD CONSTRAINT "BucketListItem_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucketListItem" ADD CONSTRAINT "BucketListItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucketListItem" ADD CONSTRAINT "BucketListItem_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
