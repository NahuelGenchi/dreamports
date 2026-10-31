import { defineCollection } from 'astro:content';
import { glob, type Loader } from 'astro/loaders';
import { z } from 'astro/zod';
import { ICON_NAMES } from './lib/icons';
import { ENTRY, GITHUB_NAME, THREAD, pageOf } from './lib/entries.mjs';

// Every game on the site. A Dreamport's page comes from its entry, games/<game>/entry.md, which
// games/README.md explains field by field; every other game's from one Markdown file in
// src/content/games/, which CONTRIBUTING.md explains.
const mediaFile = z.string().regex(/^\/media\/[a-z0-9-]+\.webp$/, 'a .webp file in public/media/, such as /media/my-port-still.webp');
// A recording, named without its ending: /media/my-port stands for my-port.h264.mp4 and my-port.av1.mp4.
const clipFile = z.string().regex(/^\/media\/[a-z0-9-]+$/, 'a recording in public/media/ without its ending, such as /media/my-port');
const https = z.url({ protocol: /^https$/ });
const githubName = z.string().regex(GITHUB_NAME, 'a GitHub account’s name, such as NahuelGenchi');

// What every game's page has.
const page = {
  title: z.string(),
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
          href: https,
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
};

const controls = z.array(z.enum(['keyboard', 'controller', 'touch'])).min(1);
// A fact is a line of text, or a link, in the game's box.
const fact = z.object({ label: z.string(), value: z.string(), href: https.optional() });

// A Dreamport's entry. Its kind and its folder come from where it is; its two numbers from its proof/ folder.
const dreamport = z.object({
  ...page,
  kind: z.literal('dreamport'),
  game: z.string(),
  // the exact copy players need, as the proof names it in proof/original.json
  needs: z.string(),
  controls,
  // who leads it and who works on it with them, by their GitHub accounts
  lead: githubName,
  team: z.array(githubName).default([]),
  // the console's kit it's built on, a folder in kit/
  kit: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'a kit’s folder in kit/, such as gba'),
  // every source of its code: what it is, its license, and whether code came in or it was only read
  sources: z
    .array(
      z
        .object({
          name: z.string(),
          href: https,
          license: z.string(),
          use: z.enum(['code', 'guide']),
          // a link to its authors' agreement, for code brought in without a license that allows it
          agreement: https.optional(),
        })
        .refine((source) => source.use === 'guide' || source.license !== 'none' || source.agreement, {
          message: 'code brought in without a license needs a link to its authors’ agreement',
        }),
    )
    .default([]),
  // the game's progress thread, and the lead's team preview, which nobody has reviewed
  thread: z.string().regex(THREAD, 'a discussion in NahuelGenchi/dreamports, such as https://github.com/NahuelGenchi/dreamports/discussions/110').optional(),
  preview: https.optional(),
  // more lines for the game's box, such as an article about it
  facts: z.array(fact).default([]),
});

// Every other game: an external port, or a fan game that isn't a port.
const other = z.object({
  ...page,
  kind: z.enum(['external', 'other']),
  facts: z
    .array(fact.partial({ value: true }).extend({ controls: controls.optional() }).refine((f) => f.value || f.controls, 'a value or controls'))
    .default([]),
});

// Both kinds of page, from games/*/entry.md and src/content/games/*.md. An entry's kind and folder are set
// here, from where it is, so the entry itself doesn't write them.
function games(): Loader {
  const files = glob({
    pattern: [`games/*/${ENTRY}`, 'src/content/games/*.md'],
    base: '.',
    generateId: ({ entry }) => {
      const dreamport = /^games\/([^/]+)\//.exec(entry);
      return dreamport ? pageOf(dreamport[1]) : entry.replace(/^.*\//, '').replace(/\.md$/, '');
    },
  });
  return {
    name: 'dreamports-games',
    load: (context) =>
      files.load({
        ...context,
        parseData: (async (props: Parameters<typeof context.parseData>[0]) => {
          const file = (props.filePath ?? '').replaceAll('\\', '/');
          const data = props.data as Record<string, unknown>;
          const game = new RegExp(`/games/([^/]+)/${ENTRY.replace('.', '\\.')}$`).exec(file)?.[1];
          if (game) {
            for (const key of ['kind', 'game'] as const) {
              if (key in data) throw new Error(`games/${game}/${ENTRY}: "${key}" comes from where the entry is, so leave it out.`);
            }
            return context.parseData({ ...props, data: { ...data, kind: 'dreamport', game } });
          }
          if (data.kind === 'dreamport') {
            throw new Error(`src/content/games/${file.replace(/^.*\//, '')}: a Dreamport’s page comes from its entry, games/<game>/${ENTRY}, as games/README.md explains.`);
          }
          return context.parseData(props);
        }) as typeof context.parseData,
      }),
  };
}

export const collections = {
  games: defineCollection({ loader: games(), schema: z.discriminatedUnion('kind', [dreamport, other]) }),
};
