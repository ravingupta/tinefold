import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { ExpansionInputs } from "../schema/common";
import { canonicalJson } from "./canonical";

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

/**
 * contextHash = sha256(canonical JSON of {rootVersion, commentIds, decisionIds,
 * answerIds, ancestorSelectionIds, nodeVersionId}). Over ids, not text.
 * nodeVersionId is the version whose context was compiled (the parent being expanded).
 */
export function hashContext(inputs: ExpansionInputs, nodeVersionId: string): string {
  return sha256Hex(
    canonicalJson({
      rootVersion: inputs.rootVersion,
      commentIds: inputs.commentIds,
      decisionIds: inputs.decisionIds,
      answerIds: inputs.answerIds,
      ancestorSelectionIds: inputs.ancestorSelectionIds,
      nodeVersionId,
    }),
  );
}
