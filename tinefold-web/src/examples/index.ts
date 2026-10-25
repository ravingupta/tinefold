import raw from "./tinefold-design.events.json";

/**
 * The example brainstorm: the design discussion behind tinefold itself, as an event log.
 * Two root versions (a server-backed first attempt, then the browser-only rewrite), reused
 * branches, rejected options with reasons, six open problems, and three attached documents.
 * Imported with importEvents(), which validates every event through the engine.
 */
export const exampleEvents = raw as unknown[];
