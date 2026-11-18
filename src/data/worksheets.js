export const PROGRAM_KEY = 'reignite-8-week';
export const PROGRAM_NAME = '8-week relationship program';
export const WEEK_COUNT = 8;

export const RATING_COPY = {
  headingSuffix: 'Ratings - Individual (1 min)',
  description: 'Rate each from 1 to 10, with 1 being the worst it could possibly be and 10 being the closest to your ideal that you could possibly imagine.',
};

export const RATING_QUESTIONS = [
  { key: 'desireRating', label: 'My desire for my partner:' },
  { key: 'happinessRating', label: 'My happiness in this relationship:' },
  { key: 'connectionRating', label: 'My feeling of connection to my partner:' },
];

const checklist = (weekNumber) => ({
  key: `week-${weekNumber}-checklist`,
  title: `Week ${weekNumber} Checklist`,
  kind: 'checklist',
});

export const WEEKS = [
  {
    weekNumber: 1,
    items: [
      { key: 'our-story', title: 'Our Story Worksheet', kind: 'pdf' },
      checklist(1),
    ],
  },
  {
    weekNumber: 2,
    items: [
      { key: 'attachment-structure', title: 'My Attachment Structure Worksheet', kind: 'pdf' },
      checklist(2),
    ],
  },
  {
    weekNumber: 3,
    items: [
      { key: 'practices-311', title: 'Your 3:1:1 Practices', kind: 'pdf' },
      { key: 'structured-meeting', title: 'The Structured Meeting', kind: 'pdf' },
      checklist(3),
    ],
  },
  {
    weekNumber: 4,
    items: [
      { key: 'felt-heard', title: 'Felt Heard Reflection', kind: 'pdf' },
      { key: 'sensate-focus', title: 'Sensate Focus Exercise', kind: 'pdf' },
      { key: 'cycle-awareness-log', title: 'Cycle Awareness Log', kind: 'pdf' },
      { key: 'cycle-reference', title: 'Our Cycle Reference Sheet', kind: 'pdf' },
      checklist(4),
    ],
  },
  {
    weekNumber: 5,
    items: [
      { key: 'cycle-and-desire', title: 'Cycle and Desire', kind: 'pdf' },
      { key: 'cycle-awareness-log', title: 'Cycle Awareness Log', kind: 'pdf' },
      { key: 'cycle-reference', title: 'Our Cycle Reference Sheet', kind: 'pdf' },
      { key: 'gold-star', title: 'Gold Star Chart', kind: 'pdf' },
      checklist(5),
    ],
  },
  {
    weekNumber: 6,
    items: [
      { key: 'cycle-awareness-log', title: 'Cycle Awareness Log', kind: 'pdf' },
      { key: 'joint-cycle-reflection', title: 'Joint Cycle Reflection', kind: 'pdf' },
      { key: 'connection-play-fantasy', title: 'Connection, Play and Fantasy', kind: 'pdf' },
      { key: 'sensate-focus-progression', title: 'Sensate Focus Progression', kind: 'pdf' },
      { key: 'gold-star', title: 'Gold Star Chart', kind: 'pdf' },
      checklist(6),
    ],
  },
  {
    weekNumber: 7,
    items: [
      { key: 'cycle-awareness-log', title: 'Cycle Awareness Log', kind: 'pdf' },
      { key: 'practical-obstacles', title: 'Practical Obstacles to Sex', kind: 'pdf' },
      { key: 'definition-of-sex', title: 'Our Definition of Sex', kind: 'pdf' },
      { key: 'sex-with-intention', title: 'Sex with Intention', kind: 'pdf' },
      { key: 'gold-star', title: 'Gold Star Chart', kind: 'pdf' },
      checklist(7),
    ],
  },
  {
    weekNumber: 8,
    items: [
      { key: 'our-story', title: 'Our Story', kind: 'pdf' },
      { key: 'individual-reflections', title: 'Individual Reflections', kind: 'pdf' },
      { key: 'gold-star', title: 'Gold Star Chart', kind: 'pdf' },
      checklist(8),
    ],
  },
];

export function weekDefinition(weekNumber) {
  return WEEKS.find((week) => week.weekNumber === Number(weekNumber)) || null;
}

export function worksheetDefinition(weekNumber, worksheetKey) {
  const week = weekDefinition(weekNumber);
  if (!week) return null;
  return week.items.find((item) => item.key === worksheetKey) || null;
}
