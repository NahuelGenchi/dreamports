import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// One Markdown file in src/content/games/ is one game page.
// CONTRIBUTING.md explains every field in plain words.
const mediaFile = z.string().regex(/^\/media\/[a-z0-9-]+\.webp$/, 'a .webp file in public/media/, such as /media/my-port.webp');

const games = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/games' }),
  schema: z.object({
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
    // The game's little screen in the launcher: only the maker's own recording, never box art
    // or publisher images. The still is the recording's first frame. Without a screen, the game
    // gets a plain dreamports card.
    screen: z
      .object({
        clip: mediaFile,
        still: mediaFile,
        pixelated: z.boolean().default(false),
      })
      .optional(),
    // The picture shown when the game's page is shared: 1200×630, made from the same recording.
    // Without one, the page shares the site's own picture.
    share: z
      .string()
      .regex(/^\/media\/[a-z0-9-]+\.(png|jpg)$/, 'a .png or .jpg file in public/media/, such as /media/my-port-share.png')
      .optional(),
    // The light the game's screen casts on the menu while it's selected.
    glow: z
      .string()
      .regex(/^#[0-9a-f]{6}$/, 'a colour such as #8fd1ff')
      .default('#8fd1ff'),
  }),
});

export const collections = { games };
