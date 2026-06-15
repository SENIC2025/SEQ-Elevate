-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "courseSlug" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL,
    "video" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonDocument" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lesson_projectId_courseSlug_idx" ON "Lesson"("projectId", "courseSlug");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_projectId_courseSlug_stageKey_key" ON "Lesson"("projectId", "courseSlug", "stageKey");

-- CreateIndex
CREATE INDEX "LessonDocument_lessonId_idx" ON "LessonDocument"("lessonId");

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonDocument" ADD CONSTRAINT "LessonDocument_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
