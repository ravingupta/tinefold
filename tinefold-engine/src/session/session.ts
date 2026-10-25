import {
  DEFAULT_HARD_CEILING,
  DEFAULT_SOFT_CEILING,
  compileContext,
  compileGraphContext,
  documentKey,
  estimateTokens,
  renderSections,
  type CompiledContext,
} from "../context/compile";
import { hashContext } from "../context/hash";
import {
  PROMPT_VERSION,
  REWRITE_SYSTEM,
  STALE_CHECK_SYSTEM,
  SUMMARIZE_SYSTEM,
  SYSTEM_PROMPT,
  documentPrompt,
} from "../prompts";
import { callStructured } from "../providers/structured";
import { resolveStage, type Provider, type ProviderRegistry, type Stage } from "../providers/types";
import { replay, reduce } from "../reducer/reduce";
import type { ExpansionInputs } from "../schema/common";
import { EngineError } from "../schema/errors";
import { GraphEvent, type ExpansionItem } from "../schema/events";
import {
  ExpansionOutput,
  EXPANSION_JSON_SCHEMA,
  REGENERATION_JSON_SCHEMA,
  ROOT_REWRITE_JSON_SCHEMA,
  RegenerationOutput,
  RootRewriteOutput,
  STALE_CHECK_JSON_SCHEMA,
  StaleCheckOutput,
} from "../schema/expansion";
import {
  ROOT_NODE_ID,
  type DocType,
  type DocumentEntry,
  type Expansion,
  type Graph,
  type NodeVersion,
} from "../schema/graph";
import { currentRoot, currentVersionIdOf, kindOf, titleOf } from "../select/lookup";
import { currentInputs, staleDetails } from "../select/stale";
import { enabledSet } from "../select/traversal";
import {
  assumptions,
  renderTree,
  restartWarning,
  type AssumptionEntry,
  type RestartWarning,
  type TreeNode,
} from "../select/tree";
import {
  ancestorChain,
  completeness,
  decisionSummary,
  suggestedNext,
  type ChainLink,
  type Completeness,
  type DecisionSummary,
} from "../select/views";
import type { StorageAdapter } from "../storage/types";
import { ulid } from "./ids";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An event before the session stamps its envelope. */
export type EventDraft = DistributiveOmit<GraphEvent, "id" | "graphId" | "seq" | "at">;

export interface SessionOptions {
  storage: StorageAdapter;
  /** Providers by id, or a list (keyed by each provider's id). */
  providers: Record<string, Provider> | Provider[];
  registry: ProviderRegistry;
  now?: () => string;
  newId?: () => string;
  softCeiling?: number;
  hardCeiling?: number;
  maxTokens?: Partial<Record<Stage, number>>;
}

export interface CreateSessionOptions extends SessionOptions {
  /** Open an existing graph. */
  graphId?: string;
  /** Create a new graph with this root problem statement. */
  statement?: string;
}

export interface DocumentRequest {
  docType: DocType;
  /** Required for "custom"; optional extra guidance for the others. */
  instructions?: string;
  /** Regenerate even when a cached copy matches the current graph. */
  force?: boolean;
}

export interface GeneratedDocument {
  markdown: string;
  cached: boolean;
  entry: DocumentEntry;
}

export type Listener = (snapshot: Graph) => void;

export interface Session {
  readonly graphId: string;
  getSnapshot(): Graph;
  subscribe(listener: Listener): () => void;
  readonly select: {
    enabledSet(): ReadonlySet<string>;
    staleMarks(): ReturnType<typeof staleDetails>;
    completeness(): Completeness;
    decisionSummary(): DecisionSummary;
    ancestorChain(nodeId: string): ChainLink[];
    suggestedNext(): string | null;
    restartWarning(): RestartWarning | null;
    tree(): TreeNode;
    assumptions(): AssumptionEntry[];
    documents(): DocumentEntry[];
    lastTokens(): number;
  };
  addComment(text: string): Promise<void>;
  selectSolution(problemNodeId: string, solutionNodeId: string | null): Promise<void>;
  answerClarification(nodeId: string, answer: { itemId?: string; freeText?: string }): Promise<void>;
  approveRootRewrite(statement: string, mergedCommentIds: string[]): Promise<void>;
  portNode(sourceNodeId: string, targetNodeId: string): Promise<string>;
  expand(nodeId: string, opts?: { allowClarify?: boolean; signal?: AbortSignal }): Promise<Expansion>;
  regenerate(nodeId: string, opts?: { signal?: AbortSignal }): Promise<NodeVersion>;
  proposeRootRewrite(opts?: { signal?: AbortSignal }): Promise<{ statement: string; mergedCommentIds: string[] }>;
  checkStale(nodeId: string, opts?: { signal?: AbortSignal }): Promise<{ verdict: "fresh" | "stale"; reason: string }>;
  generateDocument(req: DocumentRequest, opts?: { signal?: AbortSignal }): Promise<GeneratedDocument>;
  /** generateDocument({docType: "prd"}). */
  generatePrd(opts?: { signal?: AbortSignal; force?: boolean }): Promise<GeneratedDocument>;
  compileContext(nodeId: string): { text: string; hash: string; tokens: number };
  exportEvents(): Promise<GraphEvent[]>;
  setRegistry(registry: ProviderRegistry): void;
  setProviders(providers: Record<string, Provider> | Provider[]): void;
}

const DEFAULT_MAX_TOKENS: Record<Stage, number> = { expand: 3000, staleCheck: 600, summarize: 1500, document: 8000 };

export async function createSession(opts: CreateSessionOptions): Promise<Session> {
  if (opts.graphId) return openSession(opts.graphId, opts);
  if (opts.statement) return createGraph(opts.statement, opts);
  throw new EngineError("ValidationFailed", "createSession needs a graphId or a statement");
}

export async function createGraph(statement: string, opts: SessionOptions): Promise<Session> {
  const text = statement.trim();
  if (!text) throw new EngineError("ValidationFailed", "the problem statement is empty");
  const newId = opts.newId ?? (() => ulid());
  const now = opts.now ?? (() => new Date().toISOString());
  const graphId = newId();
  const event = GraphEvent.parse({
    id: newId(),
    graphId,
    seq: 1,
    at: now(),
    type: "GraphCreated",
    payload: { graphId, statement: text },
  });
  const g = reduce(null, event);
  await opts.storage.appendEvent(event);
  await opts.storage.writeSnapshot(graphId, g, g.seq);
  return new GraphSession(g, opts);
}

/** Import an exported event log as a new graph (fresh graphId, same content). */
export async function importGraph(events: unknown[], opts: SessionOptions): Promise<Session> {
  const newId = opts.newId ?? (() => ulid());
  const graphId = newId();
  const parsed = events.map((e) => GraphEvent.parse({ ...(e as object), graphId: (e as { graphId: string }).graphId }));
  const rewritten = parsed.map((e) =>
    GraphEvent.parse(
      e.type === "GraphCreated"
        ? { ...e, graphId, payload: { ...e.payload, graphId } }
        : { ...e, graphId },
    ),
  );
  const g = replay(rewritten);
  for (const e of rewritten) await opts.storage.appendEvent(e);
  await opts.storage.writeSnapshot(graphId, g, g.seq);
  return new GraphSession(g, opts);
}

export async function openSession(graphId: string, opts: SessionOptions): Promise<Session> {
  const snap = await opts.storage.readSnapshot(graphId);
  let g: Graph | null = null;
  try {
    g = snap ? (snap.snapshot as Graph) : null;
    if (g && !g.documents) g = { ...g, documents: {} };
    const tail = await opts.storage.readEvents(graphId, (snap?.seq ?? 0) + 1);
    for (const e of tail) g = reduce(g, GraphEvent.parse(e));
  } catch {
    // A snapshot that fails to fold forward is repaired from the full log.
    g = replay((await opts.storage.readEvents(graphId)).map((e) => GraphEvent.parse(e)));
  }
  if (!g) throw new EngineError("ValidationFailed", `graph ${graphId} not found`);
  if (!snap || snap.seq !== g.seq) await opts.storage.writeSnapshot(graphId, g, g.seq).catch(() => undefined);
  return new GraphSession(g, opts);
}

class GraphSession implements Session {
  readonly graphId: string;
  private g: Graph;
  private readonly listeners = new Set<Listener>();
  private queue: Promise<unknown> = Promise.resolve();
  private providers: Record<string, Provider> = {};
  private registry: ProviderRegistry;
  private readonly condensed = new Map<string, string>();
  private tokensLast = 0;

  constructor(g: Graph, private readonly opts: SessionOptions) {
    this.g = g;
    this.graphId = g.id;
    this.registry = opts.registry;
    this.setProviders(opts.providers);
  }

  // --- state ---

  getSnapshot(): Graph {
    return this.g;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  readonly select: Session["select"] = {
    enabledSet: () => enabledSet(this.g),
    staleMarks: () => staleDetails(this.g),
    completeness: () => completeness(this.g),
    decisionSummary: () => decisionSummary(this.g),
    ancestorChain: (nodeId) => ancestorChain(this.g, nodeId),
    suggestedNext: () => suggestedNext(this.g),
    restartWarning: () => restartWarning(this.g),
    tree: () => renderTree(this.g),
    assumptions: () => assumptions(this.g),
    documents: () => Object.values(this.g.documents ?? {}).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    lastTokens: () => this.tokensLast,
  };

  setRegistry(registry: ProviderRegistry): void {
    this.registry = registry;
  }

  setProviders(providers: Record<string, Provider> | Provider[]): void {
    this.providers = Array.isArray(providers) ? Object.fromEntries(providers.map((p) => [p.id, p])) : { ...providers };
  }

  async exportEvents(): Promise<GraphEvent[]> {
    return this.opts.storage.readEvents(this.graphId);
  }

  compileContext(nodeId: string) {
    const c = compileContext(this.g, nodeId, { kind: "expand" });
    return { text: c.text, hash: c.hash, tokens: c.tokens };
  }

  // --- event plumbing ---

  private now(): string {
    return (this.opts.now ?? (() => new Date().toISOString()))();
  }

  private id(): string {
    return (this.opts.newId ?? (() => ulid()))();
  }

  /** Serialise all writes so seq never races, even with several provider calls in flight. */
  private dispatch(draft: EventDraft): Promise<Graph> {
    const run = async () => {
      const event = GraphEvent.parse({ id: this.id(), graphId: this.graphId, seq: this.g.seq + 1, at: this.now(), ...draft });
      const next = reduce(this.g, event);
      await this.opts.storage.appendEvent(event);
      this.g = next;
      this.opts.storage.writeSnapshot(this.graphId, next, next.seq).catch(() => undefined);
      for (const l of this.listeners) l(next);
      return next;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private provider(stage: Stage): { provider: Provider; model: string; generatedBy: { providerId: string; model: string; promptVersion: string } } {
    const ref = resolveStage(this.registry, stage);
    const provider = this.providers[ref.providerId];
    if (!provider) {
      throw new EngineError("ProviderFailed", `no provider "${ref.providerId}" is configured for the ${stage} stage`, { stage, providerId: ref.providerId });
    }
    return { provider, model: ref.model, generatedBy: { providerId: provider.id, model: ref.model, promptVersion: PROMPT_VERSION } };
  }

  private maxTokens(stage: Stage): number {
    return this.opts.maxTokens?.[stage] ?? DEFAULT_MAX_TOKENS[stage];
  }

  /** Apply the token budget: condense decisions above the soft ceiling, refuse above the hard one. */
  private async budget(ctx: CompiledContext, signal?: AbortSignal): Promise<string> {
    const soft = this.opts.softCeiling ?? DEFAULT_SOFT_CEILING;
    const hard = this.opts.hardCeiling ?? DEFAULT_HARD_CEILING;
    let text = ctx.text;
    if (ctx.tokens > soft) {
      let condensed = this.condensed.get(ctx.hash);
      if (!condensed) {
        const { provider, model } = this.provider("summarize");
        const res = await provider.complete({ system: SUMMARIZE_SYSTEM, user: ctx.sections.decisions, model, maxTokens: this.maxTokens("summarize"), purpose: "summarize", signal });
        condensed = res.text ?? ctx.sections.decisions;
        this.condensed.set(ctx.hash, condensed);
      }
      text = renderSections({ ...ctx.sections, decisions: condensed });
    }
    const tokens = estimateTokens(text);
    this.tokensLast = tokens;
    if (tokens > hard) {
      throw new EngineError("ContextTooLarge", `context is ~${tokens} tokens, above the ${hard} ceiling`, { tokens, ceiling: hard });
    }
    return text;
  }

  // --- user actions ---

  async addComment(text: string): Promise<void> {
    const t = text.trim();
    if (!t) throw new EngineError("ValidationFailed", "comment is empty");
    await this.dispatch({ type: "CommentAdded", payload: { commentId: this.id(), text: t } });
  }

  async selectSolution(problemNodeId: string, solutionNodeId: string | null): Promise<void> {
    await this.dispatch({ type: "SolutionSelected", payload: { problemNodeId, solutionNodeId } });
  }

  async answerClarification(nodeId: string, answer: { itemId?: string; freeText?: string }): Promise<void> {
    const freeText = answer.freeText?.trim() || undefined;
    await this.dispatch({ type: "ClarificationAnswered", payload: { clarificationNodeId: nodeId, itemId: answer.itemId, freeText } });
  }

  async approveRootRewrite(statement: string, mergedCommentIds: string[]): Promise<void> {
    await this.dispatch({
      type: "RootRewritten",
      payload: { version: currentRoot(this.g).version + 1, statement: statement.trim(), mergedCommentIds },
    });
  }

  async portNode(sourceNodeId: string, targetNodeId: string): Promise<string> {
    const g = this.g;
    const source = g.nodes[sourceNodeId];
    if (!source) throw new EngineError("ValidationFailed", `unknown node ${sourceNodeId}`);
    const targetVersionId = currentVersionIdOf(g, targetNodeId);
    if (!targetVersionId) throw new EngineError("ValidationFailed", `unknown target ${targetNodeId}`);
    const newNodeId = this.id();
    const newVersionId = this.id();
    const inputs = currentInputs(g, targetVersionId);
    const sel = g.selections[sourceNodeId] ?? null;
    let selection;
    if (sel !== null) {
      // Inputs for the copied selection are computed as if the copied problem already exists.
      const provisional: Graph = {
        ...g,
        nodes: { ...g.nodes, [newNodeId]: { id: newNodeId, kind: source.kind, parentVersionId: targetVersionId, currentVersionId: newVersionId, portedFrom: source.id } },
        nodeVersions: { ...g.nodeVersions, [newVersionId]: { ...g.nodeVersions[source.currentVersionId]!, id: newVersionId, nodeId: newNodeId } },
        children: { ...g.children, [targetVersionId]: [...(g.children[targetVersionId] ?? []), newNodeId] },
      };
      const selInputs = currentInputs(provisional, newVersionId);
      selection = {
        sourceSolutionNodeId: sel,
        newNodeId: this.id(),
        newVersionId: this.id(),
        contextHash: hashContext(selInputs, newVersionId),
        inputs: selInputs,
      };
    }
    await this.dispatch({
      type: "NodePorted",
      payload: { sourceNodeId, targetParentVersionId: targetVersionId, newNodeId, newVersionId, contextHash: hashContext(inputs, targetVersionId), inputs, selection },
    });
    return newNodeId;
  }

  // --- provider-backed commands ---

  async expand(nodeId: string, opts: { allowClarify?: boolean; signal?: AbortSignal } = {}): Promise<Expansion> {
    const g = this.g;
    const kind = kindOf(g, nodeId);
    if (!kind) throw new EngineError("ValidationFailed", `unknown node ${nodeId}`);
    if (kind === "clarification") throw new EngineError("ValidationFailed", "clarifications are answered, not expanded");
    const versionId = currentVersionIdOf(g, nodeId)!;
    const exps = g.expansions[versionId] ?? [];
    if (exps.some((x) => x.kind !== "clarify")) {
      throw new EngineError("ValidationFailed", "this node is already expanded; regenerate it to start over");
    }
    if (kind === "solution" && nodeId !== ROOT_NODE_ID) {
      const parent = g.nodes[nodeId]!;
      const problem = Object.entries(g.selections).find(([, s]) => s === nodeId)?.[0];
      if (!problem) throw new EngineError("InvalidSelection", "select this solution before breaking it down");
      void parent;
    }
    const alreadyAsked = exps.some((x) => x.kind === "clarify");
    const allowClarify = opts.allowClarify ?? !alreadyAsked;
    const ctx = compileContext(g, nodeId, { kind: "expand", allowClarify });
    const user = await this.budget(ctx, opts.signal);
    const { provider, model, generatedBy } = this.provider("expand");
    const allowed = kind === "problem" ? ["solutions", "leaf", ...(allowClarify ? ["clarify"] : [])] : ["subproblems", ...(allowClarify ? ["clarify"] : [])];
    const { value: out, tokens } = await callStructured(
      provider,
      {
        system: SYSTEM_PROMPT,
        user,
        model,
        maxTokens: this.maxTokens("expand"),
        purpose: kind === "problem" ? "expand-problem" : "expand-solution",
        schema: { name: "emit_expansion", description: "Return the expansion of the node.", json: EXPANSION_JSON_SCHEMA },
        signal: opts.signal,
      },
      ExpansionOutput,
      (o) => checkExpansion(o, allowed),
    );

    const ids = new Map<string, { nodeId: string; versionId: string }>();
    const items: ExpansionItem[] = (out.kind === "leaf" ? [] : out.items).map((it) => {
      const nid = this.id();
      const vid = this.id();
      ids.set(it.id, { nodeId: nid, versionId: vid });
      return {
        nodeId: nid,
        versionId: vid,
        title: it.title,
        summary: it.summary,
        axisValue: it.axisValue,
        pros: out.kind === "solutions" ? it.pros : [],
        cons: out.kind === "solutions" ? it.cons : [],
        options: out.kind === "clarify" ? (it.options ?? []).map((o) => ({ id: o.id, title: o.title })) : undefined,
      };
    });
    const next = await this.dispatch({
      type: "NodeExpanded",
      payload: {
        parentVersionId: versionId,
        kind: out.kind,
        items,
        axis: out.kind === "solutions" ? out.axis : undefined,
        recommendedId: out.recommendedId ? ids.get(out.recommendedId)?.nodeId : undefined,
        reason: out.reason,
        suggestedNextId: out.kind === "subproblems" && out.suggestedNextId ? ids.get(out.suggestedNextId)?.nodeId : undefined,
        assumptions: out.assumptions,
        leafReason: out.kind === "leaf" ? (out.leafReason ?? "Small enough to act on directly.") : undefined,
        contextHash: ctx.hash,
        inputs: ctx.inputs,
        generatedBy,
        tokens,
      },
    });
    return next.expansions[versionId]!.at(-1)!;
  }

  async regenerate(nodeId: string, opts: { signal?: AbortSignal } = {}): Promise<NodeVersion> {
    const g = this.g;
    const node = g.nodes[nodeId];
    if (!node) throw new EngineError("ValidationFailed", "the root is changed by a rewrite, not regenerated");
    if (node.kind === "clarification") throw new EngineError("ValidationFailed", "clarifications cannot be regenerated");
    const ctx = compileContext(g, nodeId, { kind: "regenerate" });
    const user = await this.budget(ctx, opts.signal);
    const { provider, model, generatedBy } = this.provider("expand");
    const { value: out, tokens } = await callStructured(
      provider,
      {
        system: SYSTEM_PROMPT,
        user,
        model,
        maxTokens: this.maxTokens("expand"),
        purpose: "regenerate",
        schema: { name: "emit_node", description: "Return the rewritten node.", json: REGENERATION_JSON_SCHEMA },
        signal: opts.signal,
      },
      RegenerationOutput,
    );
    const versionId = this.id();
    const next = await this.dispatch({
      type: "NodeRegenerated",
      payload: {
        nodeId,
        newVersion: {
          nodeId,
          versionId,
          title: out.title,
          summary: out.summary,
          axisValue: out.axisValue,
          pros: node.kind === "solution" ? out.pros : [],
          cons: node.kind === "solution" ? out.cons : [],
        },
        contextHash: ctx.hash,
        inputs: ctx.inputs,
        generatedBy,
        tokens,
      },
    });
    return next.nodeVersions[versionId]!;
  }

  async proposeRootRewrite(opts: { signal?: AbortSignal } = {}): Promise<{ statement: string; mergedCommentIds: string[] }> {
    const g = this.g;
    const open = g.comments.filter((c) => c.mergedIntoRootVersion === undefined);
    const root = currentRoot(g);
    if (open.length === 0) return { statement: root.statement, mergedCommentIds: [] };
    const graphCtx = compileGraphContext(g);
    const user = `## Root problem\n(v${root.version}) ${root.statement}\n\n## Comments to merge\n${open.map((c) => `[id: ${c.id}] ${c.text}`).join("\n")}\n\n## Current state of the brainstorm (for reference)\n${graphCtx.text}\n\n## Task\nWrite the new root problem statement.`;
    const { provider, model } = this.provider("summarize");
    const { value } = await callStructured(
      provider,
      { system: REWRITE_SYSTEM, user, model, maxTokens: this.maxTokens("summarize"), purpose: "rewrite", schema: { name: "emit_root", description: "Return the merged root statement.", json: ROOT_REWRITE_JSON_SCHEMA }, signal: opts.signal },
      RootRewriteOutput,
    );
    const valid = new Set(open.map((c) => c.id));
    const merged = value.mergedCommentIds.filter((id) => valid.has(id));
    return { statement: value.statement.trim(), mergedCommentIds: merged.length ? merged : [...valid] };
  }

  async checkStale(nodeId: string, opts: { signal?: AbortSignal } = {}): Promise<{ verdict: "fresh" | "stale"; reason: string }> {
    const g = this.g;
    const node = g.nodes[nodeId];
    if (!node) throw new EngineError("ValidationFailed", `unknown node ${nodeId}`);
    const v = g.nodeVersions[node.currentVersionId]!;
    const now = currentInputs(g, node.parentVersionId);
    const hash = hashContext(now, node.parentVersionId);
    const changes = describeChanges(g, v.inputs, now);
    const ctx = compileContext(g, nodeId, { kind: "regenerate" });
    const user = `${ctx.text.replace(/## Task[\s\S]*$/, "")}## What changed since this node was generated\n${changes || "- (nothing recorded)"}\n\n## Task\nIs THIS NODE still a valid, sensible item given the change? Answer fresh or stale with a one-sentence reason.`;
    const { provider, model, generatedBy } = this.provider("staleCheck");
    void generatedBy;
    const { value } = await callStructured(
      provider,
      { system: STALE_CHECK_SYSTEM, user, model, maxTokens: this.maxTokens("staleCheck"), purpose: "staleCheck", schema: { name: "emit_verdict", description: "Return the staleness verdict.", json: STALE_CHECK_JSON_SCHEMA }, signal: opts.signal },
      StaleCheckOutput,
    );
    await this.dispatch({ type: "StaleChecked", payload: { nodeVersionId: v.id, verdict: value.verdict, reason: value.reason, contextHash: hash } });
    return value;
  }

  async generateDocument(req: DocumentRequest, opts: { signal?: AbortSignal } = {}): Promise<GeneratedDocument> {
    if (req.docType === "custom" && !req.instructions?.trim()) {
      throw new EngineError("ValidationFailed", "describe the document you want for a custom document");
    }
    const g = this.g;
    const ctx = compileGraphContext(g);
    const key = documentKey(req.docType, req.instructions, ctx.hash);
    const cached = g.documents?.[key];
    if (cached && !req.force) return { markdown: cached.markdown, cached: true, entry: cached };
    const hard = this.opts.hardCeiling ?? DEFAULT_HARD_CEILING;
    if (ctx.tokens > hard) throw new EngineError("ContextTooLarge", `graph context is ~${ctx.tokens} tokens`, { tokens: ctx.tokens, ceiling: hard });
    this.tokensLast = ctx.tokens;
    const { system, task } = documentPrompt(req.docType, req.instructions);
    const { provider, model, generatedBy } = this.provider("document");
    let res;
    try {
      res = await provider.complete({ system, user: `${ctx.text}\n\n## Task\n${task}`, model, maxTokens: this.maxTokens("document"), purpose: "document", signal: opts.signal });
    } catch (e) {
      if (e instanceof EngineError) throw e;
      throw new EngineError("ProviderFailed", e instanceof Error ? e.message : String(e));
    }
    const markdown = (res.text ?? "").trim();
    if (!markdown) throw new EngineError("ProviderFailed", "the provider returned an empty document");
    const next = await this.dispatch({
      type: "DocumentGenerated",
      payload: { key, docType: req.docType, instructions: req.instructions?.trim() || undefined, contextHash: ctx.hash, markdown, generatedBy, tokens: res.tokens },
    });
    const entry = next.documents[key]!;
    return { markdown, cached: false, entry };
  }

  generatePrd(opts: { signal?: AbortSignal; force?: boolean } = {}): Promise<GeneratedDocument> {
    return this.generateDocument({ docType: "prd", force: opts.force }, opts);
  }
}

function checkExpansion(o: ExpansionOutput, allowed: string[]): string | null {
  if (!allowed.includes(o.kind)) return `kind "${o.kind}" is not allowed here; use one of ${allowed.join(", ")}`;
  const ids = o.items.map((i) => i.id);
  if (new Set(ids).size !== ids.length) return "item ids must be unique";
  if (o.kind === "leaf") return null;
  if (o.items.length === 0) return `${o.kind} needs at least one item`;
  if (o.kind === "solutions") {
    if (o.items.length < 2) return "give at least two solution options";
    if (!o.axis) return "solutions need an axis";
  }
  if (o.kind === "clarify" && o.items.some((i) => (i.options?.length ?? 0) < 2)) return "each clarifying question needs at least two answer options";
  if (o.recommendedId !== undefined && !ids.includes(o.recommendedId)) return "recommendedId must be one of the item ids";
  if (o.suggestedNextId !== undefined && !ids.includes(o.suggestedNextId)) return "suggestedNextId must be one of the item ids";
  return null;
}

function describeChanges(g: Graph, before: ExpansionInputs, now: ExpansionInputs): string {
  const lines: string[] = [];
  for (const id of now.commentIds) {
    if (!before.commentIds.includes(id)) lines.push(`- New comment: ${g.comments.find((c) => c.id === id)?.text ?? id}`);
  }
  for (const id of now.decisionIds) {
    if (!before.decisionIds.includes(id)) lines.push(`- New decision elsewhere: ${titleOf(g, id)}`);
  }
  for (const id of before.decisionIds) {
    if (!now.decisionIds.includes(id)) lines.push(`- Decision withdrawn elsewhere: ${titleOf(g, id)}`);
  }
  for (const a of Object.values(g.answers)) {
    if (now.answerIds.includes(a.id) && !before.answerIds.includes(a.id)) {
      const v = g.nodeVersions[g.nodes[a.clarificationNodeId]!.currentVersionId]!;
      const opt = a.itemId ? v.options?.find((o) => o.id === a.itemId)?.title : undefined;
      lines.push(`- New answer: ${v.title} → ${[opt, a.freeText].filter(Boolean).join(" — ")}`);
    }
  }
  return lines.join("\n");
}
