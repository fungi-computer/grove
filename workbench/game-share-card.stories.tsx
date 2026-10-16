import type { StoryDefault } from "@ladle/react";
import { GameShareCard } from "../src/game-share-card.js";
import "@fungi.computer/parakeet/styles.css";

export default { title: "Grove / Published game" } satisfies StoryDefault;

const shareUrl = "https://vishnu.shiit.app/last-light";
const previewGame = {
  title: "Last Light",
  summary:
    "Keep the campfire alive until dawn in a tiny woodland survival game.",
  coverUrl: new URL(
    "../../vishnu-portal/scripts/assets/last-light-cover.png",
    import.meta.url,
  ).href,
  shareUrl,
};

export const WithCapturedCover = () => (
  <div className="flex min-h-screen items-center justify-center bg-base-200 p-lg">
    <GameShareCard
      previewGame={previewGame}
      reply={`Last Light is ready.\nShare: ${shareUrl}`}
    />
  </div>
);
