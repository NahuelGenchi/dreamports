import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { ICON_NAMES } from './lib/icons';

// One Markdown file in src/content/games/ is one game page.
// CONTRIBUTING.md explains every field in plain words.
const mediaFile = z.string().regex(/^\/media\/[a-z0-9-]+\.webp$/, 'a .webp file in public/media/, such as /media/my-port-still.webp');
// A recording, named without its ending: /media/my-port stands for my-port.h264.mp4 and my-port.av1.mp4.
const clipFile = z.string().regex(/^\/media\/[a-z0-9-]+$/, 'a recording in public/media/ without its ending, such as /media/my-port');

const games = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/games' }),
  schema: z.object({
    title: z.string(),
    kind: z.enum(['dreamport', 'external', 'other']),
    platform: z.string(),
    year: z.number().int().optional(),
    added: z.coerce.date(),
    summary: z.string(),
    // The box under the game's picture. Its links stay locked until the visitor
    // confirms they're using their own legal copy of the game.
    ownCopy: z.object({
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
    // What the game adds, one square each, with an icon from src/lib/icons.ts.
    extras: z
      .array(
        z.object({
          name: z.string(),
          icon: z.enum(ICON_NAMES),
          text: z.string(),
          // another game the extra needs
          needs: z.string().optional(),
          // the recording the game's picture shows while the extra is picked; without one, the game's own
          screen: z.object({ clip: clipFile, still: mediaFile }).optional(),
        }),
      )
      .default([]),
    // A fact is a line of text (or a link), the ways to play as icons, or how close the port is
    // to the original: in percent, or as parts of the original game, each in percent, which it averages.
    facts: z
      .array(
        z
          .object({
            label: z.string(),
            value: z.string().optional(),
            href: z.url({ protocol: /^https$/ }).optional(),
            controls: z.array(z.enum(['keyboard', 'controller', 'touch'])).min(1).optional(),
            percent: z.number().int().min(0).max(100).optional(),
            parts: z
              .array(z.object({ name: z.string(), percent: z.number().int().min(0).max(100) }))
              .min(1)
              .optional(),
          })
          .refine((fact) => fact.value || fact.controls || fact.percent !== undefined || fact.parts, 'a value, controls, percent or parts'),
      )
      .default([]),
    // The game's little screen in the launcher: only the maker's own recording, never box art
    // or publisher images. The still is the recording's first frame. Without a screen, the game
    // gets a plain dreamports card.
    screen: z
      .object({
        clip: clipFile,
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
