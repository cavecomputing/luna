import type { Conversation } from '../../shared/types.js'

/**
 * Placeholder content so the layout can be seen before any model is wired up.
 * Entirely invented — no real conversation data belongs in the repo.
 * Delete this module once conversations load from main.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Fixed base so timestamps are stable within a session. */
const now = Date.now()

export const demoChats: Conversation[] = [
  {
    id: 'c1',
    title: 'Weekend trip to the coast',
    icon: 'wave',
    mode: 'fast',
    updatedAt: now - MINUTE,
    messages: [
      {
        id: 'm1',
        role: 'user',
        at: now - 2 * MINUTE,
        text: 'I’m planning a weekend trip for two to the coast. Can you help me put together an itinerary?',
      },
      {
        id: 'm2',
        role: 'assistant',
        at: now - MINUTE,
        text: [
          'Happy to help. A couple of things would let me tailor it properly:',
          '',
          '- What sort of pace are you after, relaxing or busy?',
          '- Any must-see spots already on the list?',
          '- Do you have a stretch of coast in mind?',
          '- Anything to work around on food or budget?',
          '',
          'Once I know that I can put together a route with somewhere to stay each night.',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'c2',
    title: 'Easy weeknight dinners',
    icon: 'bowl',
    mode: 'fast',
    updatedAt: now - DAY,
    messages: [],
  },
  {
    id: 'c3',
    title: 'Book recommendations',
    icon: 'book',
    mode: 'expert',
    updatedAt: now - 2 * DAY,
    messages: [],
  },
  {
    id: 'c4',
    title: 'Workout plan at home',
    icon: 'dumbbell',
    mode: 'fast',
    updatedAt: now - 3 * DAY,
    messages: [],
  },
  {
    id: 'c5',
    title: 'Learning Italian',
    icon: 'leaf',
    mode: 'expert',
    updatedAt: now - 5 * DAY,
    messages: [],
  },
  {
    id: 'c6',
    title: 'Birthday gift ideas',
    icon: 'gift',
    mode: 'fast',
    updatedAt: now - 8 * DAY,
    messages: [],
  },
  {
    id: 'c7',
    title: 'Photography tips',
    icon: 'camera',
    mode: 'expert',
    updatedAt: now - 9 * DAY,
    messages: [],
  },
]
