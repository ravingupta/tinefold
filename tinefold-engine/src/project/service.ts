import { compileGraphContext, documentKey, estimateTokens, DEFAULT_HARD_CEILING } from "../context/compile";
import { canonicalJson } from "../context/canonical";
import { sha256Hex } from "../context/hash";
import { documentPrompt, PROMPT_VERSION } from "../prompts";
import { resolveStage, type Provider, type ProviderRegistry } from "../providers/types";
import { EngineError } from "../schema/errors";
import type { DocType, Graph } from "../schema/graph";
import { ulid } from "../session/ids";
import type { StorageAdapter } from "../storage/types";
import { Project, type ProjectDocument } from "./schema";

export interface ProjectServiceOptions {
  storage: StorageAdapter;
  now?: () => string;
  newId?: () => string;
}

export type ProjectListener = (project: Project | null, projectId: string) => void;

/** Create projects, choose which brainstorms they combine, and write documents across them. */
export class ProjectService {
  private readonly listeners = new Set<ProjectListener>();
  constructor(private readonly opts: ProjectServiceOptions) {}

  private now(): string {
    return (this.opts.now ?? (() => new Date().toISOString()))();
  }
  private id(): string {
    return (this.opts.newId ?? (() => ulid()))();
  }

  /** Called after every write with the saved project, or null after a delete. */
  subscribe(listener: ProjectListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): Promise<Project[]> {
    return this.opts.storage.listProjects();
  }

  async get(projectId: string): Promise<Project> {
    const p = await this.opts.storage.readProject(projectId);
    if (!p) throw new EngineError("ValidationFailed", `project ${projectId} not found`);
    return p;
  }

  /** Projects that include this brainstorm. */
  async forGraph(graphId: string): Promise<Project[]> {
    return (await this.list()).filter((p) => p.graphIds.includes(graphId));
  }

  async create(input: { name: string; description?: string; graphIds?: string[] }): Promise<Project> {
    const name = input.name.trim();
    if (!name) throw new EngineError("ValidationFailed", "the project needs a name");
    const at = this.now();
    return this.save(
      Project.parse({
        id: this.id(),
        name,
        description: input.description?.trim() ?? "",
        graphIds: [...new Set(input.graphIds ?? [])],
        createdAt: at,
        updatedAt: at,
        documents: {},
      }),
    );
  }

  async update(projectId: string, patch: { name?: string; description?: string }): Promise<Project> {
    const p = await this.get(projectId);
    const name = patch.name?.trim() ?? p.name;
    if (!name) throw new EngineError("ValidationFailed", "the project needs a name");
    return this.save({ ...p, name, description: patch.description?.trim() ?? p.description, updatedAt: this.now() });
  }

  async addGraph(projectId: string, graphId: string): Promise<Project> {
    const p = await this.get(projectId);
    if (p.graphIds.includes(graphId)) return p;
    return this.save({ ...p, graphIds: [...p.graphIds, graphId], updatedAt: this.now() });
  }

  async removeGraph(projectId: string, graphId: string): Promise<Project> {
    const p = await this.get(projectId);
    if (!p.graphIds.includes(graphId)) return p;
    return this.save({ ...p, graphIds: p.graphIds.filter((g) => g !== graphId), updatedAt: this.now() });
  }

  /** Move a brainstorm one place up (-1) or down (+1). Order is the reading order of documents. */
  async moveGraph(projectId: string, graphId: string, delta: -1 | 1): Promise<Project> {
    const p = await this.get(projectId);
    const i = p.graphIds.indexOf(graphId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= p.graphIds.length) return p;
    const ids = [...p.graphIds];
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    return this.save({ ...p, graphIds: ids, updatedAt: this.now() });
  }

  /** Remove a deleted brainstorm from every project that lists it. */
  async forgetGraph(graphId: string): Promise<void> {
    for (const p of await this.forGraph(graphId)) await this.removeGraph(p.id, graphId);
  }

  /** Deletes the project only. Its brainstorms are untouched. */
  async delete(projectId: string): Promise<void> {
    await this.opts.storage.deleteProject(projectId);
    for (const l of this.listeners) l(null, projectId);
  }

  /**
   * One document written across the project's brainstorms, in project order.
   * Cached on the project by type + instructions + description + every brainstorm's state.
   */
  async generateDocument(
    projectId: string,
    graphs: Graph[],
    req: { docType: DocType; instructions?: string; force?: boolean },
    ai: { providers: Record<string, Provider> | Provider[]; registry: ProviderRegistry; maxTokens?: number; hardCeiling?: number; signal?: AbortSignal },
  ): Promise<{ markdown: string; cached: boolean; entry: ProjectDocument }> {
    const project = await this.get(projectId);
    const byId = new Map(graphs.map((g) => [g.id, g]));
    const ordered = project.graphIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    if (ordered.length === 0) throw new EngineError("ValidationFailed", "add at least one brainstorm to the project first");
    if (req.docType === "custom" && !req.instructions?.trim()) {
      throw new EngineError("ValidationFailed", "describe the document you want for a custom document");
    }
    const parts = ordered.map((g) => ({ g, ctx: compileGraphContext(g) }));
    const contextHash = sha256Hex(canonicalJson({ description: project.description, graphs: parts.map((p) => [p.g.id, p.ctx.hash]) }));
    const key = documentKey(req.docType, req.instructions, contextHash);
    const cached = project.documents[key];
    if (cached && !req.force) return { markdown: cached.markdown, cached: true, entry: cached };

    const head = `## Project\n${project.name}${project.description ? `\nHow the parts relate, in the author's words: ${project.description}` : ""}`;
    const body = parts.map((p, i) => `# Brainstorm ${i + 1} of ${parts.length}\n\n${p.ctx.text}`).join("\n\n---\n\n");
    const text = `${head}\n\n${body}`;
    const tokens = estimateTokens(text);
    const hard = ai.hardCeiling ?? DEFAULT_HARD_CEILING;
    if (tokens > hard) throw new EngineError("ContextTooLarge", `the project's brainstorms add up to ~${tokens} tokens`, { tokens, ceiling: hard });

    const providers = Array.isArray(ai.providers) ? Object.fromEntries(ai.providers.map((p) => [p.id, p])) : ai.providers;
    const ref = resolveStage(ai.registry, "document");
    const provider = providers[ref.providerId];
    if (!provider) throw new EngineError("ProviderFailed", `no provider "${ref.providerId}" is configured for the document stage`);
    const { system, task } = documentPrompt(req.docType, req.instructions, { brainstorms: parts.length });
    let res;
    try {
      res = await provider.complete({ system, user: `${text}\n\n## Task\n${task}`, model: ref.model, maxTokens: ai.maxTokens ?? 10000, purpose: "document", signal: ai.signal });
    } catch (e) {
      if (e instanceof EngineError) throw e;
      throw new EngineError("ProviderFailed", e instanceof Error ? e.message : String(e));
    }
    const markdown = (res.text ?? "").trim();
    if (!markdown) throw new EngineError("ProviderFailed", "the provider returned an empty document");
    const entry: ProjectDocument = {
      key,
      docType: req.docType,
      instructions: req.instructions?.trim() || undefined,
      graphIds: ordered.map((g) => g.id),
      contextHash,
      markdown,
      generatedBy: { providerId: provider.id, model: ref.model, promptVersion: PROMPT_VERSION },
      tokens: res.tokens,
      createdAt: this.now(),
    };
    const latest = await this.get(projectId);
    await this.save({ ...latest, documents: { ...latest.documents, [key]: entry } });
    return { markdown, cached: false, entry };
  }

  private async save(project: Project): Promise<Project> {
    const p = Project.parse(project);
    await this.opts.storage.writeProject(p);
    for (const l of this.listeners) l(p, p.id);
    return p;
  }
}
