/*
  Warnings:

  - You are about to drop the column `createdAt` on the `Conversation` table. All the data in the column will be lost.
  - You are about to drop the column `mediaUrl` on the `Message` table. All the data in the column will be lost.
  - Made the column `text` on table `Message` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "Conversation_updatedAt_idx";

-- AlterTable
ALTER TABLE "Conversation" DROP COLUMN "createdAt",
ADD COLUMN     "lastReadAt" TIMESTAMP(3),
ALTER COLUMN "sourceId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Message" DROP COLUMN "mediaUrl",
ALTER COLUMN "text" SET NOT NULL;
