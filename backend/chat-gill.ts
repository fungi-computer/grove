import { defineAppSurfaceGill } from "@fungi.computer/agar/gills";

/**
 * Grove's chat on the dashboard. Grove renders it itself: M is a compact ask
 * box with the last few turns, L the full timeline. The App's ordinary frame
 * learns its Gill from the open params (src/chat-gill.tsx).
 */
export const chatGill = defineAppSurfaceGill({
  id: "chat",
  title: "Chat",
  sizes: ["M", "L"],
});
