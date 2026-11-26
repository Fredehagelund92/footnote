import { docsSchema, i18nSchema } from '@astrojs/starlight/schema'
import { i18nLoader } from '@astrojs/starlight/loaders'
import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'
import { pagePatterns, siteGroups, slugOf } from '../lib/pages.ts'

export const collections = {
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
  docs: defineCollection({
    // The pages stay where they are, in docs/ (lib/pages.ts).
    loader: glob({
      pattern: pagePatterns,
      base: '../docs',
      generateId: ({ entry }) => slugOf(entry),
    }),
    schema: (context) =>
      docsSchema({
        extend: z.object({
          /** One line on what the page holds: the landing page, search and llms.txt show it. */
          line: z.string().min(1).max(120),
          group: z.enum(siteGroups).optional(),
          order: z.number().int().min(1).optional(),
          minutes: z.number().int().min(1).optional(),
          /** The day someone last checked the page. */
          reviewed: z.coerce.date(),
          /** A screen of the app. The public site knows no instance, so it shows none. */
          open: z.object({ label: z.string(), href: z.string() }).optional(),
          /** The quick actions a section explains, by its anchor: for Ask in the app, not drawn here. */
          does: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
        }),
      })(context).transform((page) => ({
        ...page,
        description: page.line,
        lastUpdated: page.lastUpdated === false ? false : page.reviewed,
      })),
  }),
}
