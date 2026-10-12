import { buildCourseSync } from './progress.service.js';
import { TOTAL_WEEKS } from './unlock.service.js';

export async function getCourse(user) {
  const sync = await buildCourseSync(user);
  return {
    totalWeeks: TOTAL_WEEKS,
    currentWeek: sync.course.currentWeek,
    courseCompleted: sync.course.courseCompleted,
    weeks: sync.user.weeks.map((week) => ({
      weekNumber: week.weekNumber,
      unlocked: week.unlocked,
      totalChapters: week.totalChapters,
      chapters: week.chapters.map((chapter) => ({
        chapterId: chapter.chapterId,
        chapterName: chapter.chapterName,
        chapterOrder: chapter.chapterOrder,
      })),
    })),
  };
}

export async function getCourseSync(user) {
  return buildCourseSync(user);
}
