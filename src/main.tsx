import { mountApp } from "@fungi.computer/agar/react";
import { createQueryClient } from "@fungi.computer/agar/query";
import { createElement } from "react";
import { InboxApp } from "./inbox.js";
import "@fungi.computer/stipe/fonts-sans.css";
import "./grove.css";

const root = document.getElementById("inbox-root");
if (!root) throw new Error("Inbox root is missing");
mountApp(root, { name: "Grove", queryClient: createQueryClient() }, ({ app }) =>
  createElement(InboxApp, { connection: app }),
);
