import type { Graph } from "../schema/graph";
import { currentRoot } from "./lookup";

const FILLER = /^(?:(?:we|i)\s+(?:need|want|would like|have)\s+(?:to\s+)?|(?:how\s+(?:do|can|should|could|would)\s+(?:we|i)\s+)|(?:help\s+(?:me|us)\s+(?:to\s+)?)|(?:let'?s\s+)|(?:please\s+))+/i;
const STOP = new Set(
  "a an the for of to with and or that which who our my your their we i is are be in on at by from into using via so as it this these those".split(" "),
);

/**
 * A short (2–4 word) name derived from a problem statement, without a model call.
 * Takes the first clause, drops leading filler ("we need to", "how can we") and
 * stops at the first connecting word once two content words are in.
 */
export function suggestName(statement: string): string {
  const clause = statement.trim().split(/[.;:!?\n,(—–]|\s-\s/)[0]!.replace(FILLER, "").trim();
  const words: string[] = [];
  for (const raw of clause.split(/\s+/)) {
    const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!w) continue;
    if (STOP.has(w.toLowerCase())) {
      if (words.length >= 2) break;
      continue;
    }
    words.push(w);
    if (words.length === 4) break;
  }
  if (words.length === 0) return "Untitled brainstorm";
  const name = words.map(capitalise).join(" ");
  return name.length > 60 ? `${name.slice(0, 59).trimEnd()}…` : name;
}

function capitalise(w: string): string {
  return w.replace(/(^|[-/])(\p{Ll})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}

/** The brainstorm's display name: the stored one, else one derived from the current statement. */
export function graphName(g: Graph): string {
  return g.name ?? suggestName(currentRoot(g).statement);
}

/** True while an automatic name may still replace the current one. */
export function nameIsAuto(g: Graph): boolean {
  return g.nameSource !== "user";
}

