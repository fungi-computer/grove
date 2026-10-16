import { DurableObject } from "cloudflare:workers";
import { appBackend, type GroveMethodContext } from "./methods.js";

type GroveEnv = GroveMethodContext["env"];

/** Methods and Gills share the generated, admitted backend entry. */
class GroveFacet extends DurableObject<GroveEnv> {
  declare public readonly env: GroveEnv;
}

export const Grove = appBackend.implement(GroveFacet);
