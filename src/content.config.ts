import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// One Markdown file in src/content/games/ is one game page.
// CONTRIBUTING.md explains every field in plain words.
const games = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/games' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      kind: z.enum(['dreamport', 'external', 'other']),
      platform: z.string(),
      year: z.number().int().optional(),
      added: z.coerce.date(),
      summary: z.string(),
      lead: z.string(),
      // The "before you play" box. Its links stay locked until the visitor
      // confirms they're using their own legal copy of the game.
      ownCopy: z.object({
        text: z.string(),
        confirm: z.string(),
        links: z
          .array(
            z.object({
              label: z.string(),
              href: z.url({ protocol: /^https$/ }),
              icon: z.enum(['play', 'download']).default('play'),
            }),
          )
          .min(1),
        note: z.string(),
      }),
      facts: z
        .array(
          z.object({
            label: z.string(),
            value: z.string(),
            href: z.url({ protocol: /^https$/ }).optional(),
          }),
        )
        .default([]),
      // Only the maker's own recordings, never box art or publisher images.
      media: z
        .object({
          src: image(),
          alt: z.string(),
          caption: z.string().optional(),
        })
        .optional(),
    }),
});

export const collections = { games };
