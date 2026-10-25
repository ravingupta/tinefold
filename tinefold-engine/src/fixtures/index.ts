import raw from "./design-session.events.json";
import type { GraphEvent } from "../schema/events";

/** The design session that produced the spec, as an event log. Useful as a demo graph. */
export const designSessionEvents = raw as unknown as GraphEvent[];
