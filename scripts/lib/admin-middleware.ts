/**
 * The admin's entire server side: a Vite dev-server middleware.
 *
 * It is registered only when NODE_ENV is not 'production' (see vite.config.ts),
 * so it never exists in a deployed build. That is why there is no
 * authentication here — there is no runtime to authenticate against. The write
 * surface is deliberately two files and nothing else.
 */
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { episodesFileSchema, overridesFileSchema } from '../../src/schemas';
import { contentPath, formatZodError, readJson, seriesMetadataPath, writeJson } from './paths';

const WRITE_TARGETS = {
  '/__admin/episodes': { file: 'episodes.json', schema: episodesFileSchema },
  '/__admin/overrides': { file: 'overrides.json', schema: overridesFileSchema },
} as const;

const READ_TARGETS: Record<string, { file: string }> = {
  '/__admin/queue': { file: 'queue.json' },
  '/__admin/episodes': { file: 'episodes.json' },
  '/__admin/overrides': { file: 'overrides.json' },
  '/__admin/series': { file: 'series.json' },
};

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function adminWriteMiddleware(): Plugin {
  if (process.env.NODE_ENV === 'production') throw new Error('admin is dev-only');

  return {
    name: 'oldcartoons-admin-write',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? '';
        if (!url.startsWith('/__admin/')) return next();

        void (async () => {
          try {
            if (req.method === 'GET') {
              // The admin also needs the cached TMDB images response, which
              // lives outside publicDir and so cannot be served statically.
              const images = /^\/__admin\/images\/(-?\d+)$/.exec(url);
              if (images?.[1]) {
                return json(res, 200, readJson(seriesMetadataPath(Number(images[1]))));
              }
              const target = READ_TARGETS[url];
              if (!target) return json(res, 404, { error: `unknown admin route ${url}` });
              return json(res, 200, readJson(contentPath(target.file)));
            }

            if (req.method === 'POST') {
              const target = WRITE_TARGETS[url as keyof typeof WRITE_TARGETS];
              if (!target) return json(res, 404, { error: `unknown admin route ${url}` });

              const parsed = target.schema.safeParse(await readBody(req));
              if (!parsed.success) {
                // Same schema the build gate uses, so the admin cannot write
                // anything that would later fail `npm run build-data`.
                return json(res, 422, {
                  error: `rejected by schema:\n${formatZodError(parsed.error)}`,
                });
              }

              writeJson(contentPath(target.file), parsed.data);
              return json(res, 200, { ok: true, wrote: target.file });
            }

            return json(res, 405, { error: `${req.method} not allowed` });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            server.config.logger.error(`[admin] ${url}: ${message}`);
            return json(res, 500, { error: message });
          }
        })();
      });
    },
  };
}
