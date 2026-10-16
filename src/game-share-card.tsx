import { GameShareCard as PublishedGameCard } from "@fungi.computer/caps/blocks/game-share-card";
import { Badge } from "@fungi.computer/caps/components/badge";
import { CopyField } from "@fungi.computer/caps/components/copy-field";
import { queryKeys } from "@fungi.computer/agar/query";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const gameResponse = z.object({
  game: z.object({
    title: z.string().min(1),
    summary: z.string(),
    coverUrl: z.url().nullable(),
    shareUrl: z.url(),
  }),
});
export type Game = z.infer<typeof gameResponse>["game"];
export type GameSharePreview = Game;

/** Both Vishnu publish paths emit `Share: <url>`; the Agent copies that line into its reply. */
export function gameShareUrl(reply: string): string | null {
  const match = /(?:^|\n)\s*Share:\s*(https?:\/\/[^\s<>]+)/iu.exec(reply);
  if (!match?.[1]) return null;
  const candidate = match[1].replace(/[.,;!?]+$/u, "");
  if (!URL.canParse(candidate)) return null;
  const url = new URL(candidate);
  if (url.username || url.password || url.hash) return null;
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    return null;
  return url.href;
}

/** Keep the machine-readable Share line in the reply, but let the card own its display. */
export function gameShareDisplayText(reply: string): string {
  if (!gameShareUrl(reply)) return reply;
  return reply
    .split("\n")
    .filter((line) => !/^\s*Share:\s*/iu.test(line))
    .join("\n")
    .trim();
}

function gameApiUrl(href: string): URL | null {
  const url = new URL(href);
  const slug = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/u.exec(url.pathname)?.[1];
  if (!slug || url.search) return null;
  return new URL(`/api/games/${slug}`, url.origin);
}

/** A published game stays in the reply, with its canonical portal facts beside it. */
export function GameShareCard({
  reply,
  previewGame,
}: {
  reply: string;
  /** Workbench-only data for visual review; the mounted App reads the portal. */
  previewGame?: GameSharePreview;
}) {
  const href = gameShareUrl(reply);
  const api = href ? gameApiUrl(href) : null;
  const { data } = useQuery({
    // Portal facts are public and identified by their canonical URL, independent
    // of the selected Computer. Preview fixtures never populate this cache.
    queryKey: queryKeys.of(null, "game-share", href),
    enabled: api !== null && previewGame === undefined,
    queryFn: async ({ signal }) => {
      if (!api) return null;
      const response = await fetch(api, { signal });
      if (!response.ok) return null;
      const parsed = gameResponse.safeParse(await response.json());
      return parsed.success && parsed.data.game.shareUrl === href
        ? parsed.data.game
        : null;
    },
  });
  const game = previewGame ?? data;
  if (!href) return null;
  const url = new URL(href);
  const prettyUrl = `${url.host}${url.pathname.replace(/\/$/u, "")}`;
  const cover =
    game?.coverUrl && api
      ? previewGame
        ? game.coverUrl
        : new URL(`${api.pathname}/cover`, api.origin).href
      : null;
  return (
    <PublishedGameCard
      data-game-share-card="true"
      data-theme="vishnu"
      heading={game?.title ?? "Your game is ready"}
      eyebrow={
        <Badge tone="secondary" variant="quiet">
          Made with your Agent
        </Badge>
      }
      cover={
        cover ? (
          <img alt={`A scene from ${game?.title ?? "your game"}`} src={cover} />
        ) : null
      }
      action={
        <a href={href} rel="noopener noreferrer" target="_blank">
          Play ↗
        </a>
      }
    >
      {game?.summary ? <p className="text-sm">{game.summary}</p> : null}
      <CopyField
        displayValue={prettyUrl}
        fieldLabel="Share link"
        label="Copy link"
        value={href}
      />
    </PublishedGameCard>
  );
}
