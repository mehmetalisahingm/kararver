import { CommentView, PollDetail, ReactionSummary as WireReaction, dataOf, pageOf } from "@kararver/contracts";
import { HttpClient } from "../../lib/http-client.ts";
import { UiError } from "../../lib/model.ts";
import type { Comment, CommentDraft, Engagement, Reaction } from "./model.ts";

type PageRequest = { endpoint: string; id: string; kind?: string; cursor?: string };
type State = { data: Engagement; pending: PageRequest[] };
export const mapReaction = (r: ReturnType<typeof WireReaction.parse>) => ({ likes: r.likes, dislikes: r.dislikes, own: r.viewer === "LIKE" ? "like" as const : r.viewer === "DISLIKE" ? "dislike" as const : null });
export function mapComment(c: ReturnType<typeof CommentView.parse>): Comment {
  return { id:c.id, author:c.author?.displayName ?? "", text:c.deleted ? "" : c.body ?? "", kind:c.kind === "ALTERNATIVE" ? "alternative" : "comment", parentId:c.parentId, createdAt:c.createdAt, edited:c.editedAt !== null, deleted:c.deleted, canEdit: !c.deleted && (c.viewer?.canEdit ?? false), reaction:mapReaction({...c.reactions, viewer:c.viewer?.reaction ?? null}) };
}
export class ApiEngagement {
  private states = new Map<string, State>();
  private generation = 0;
  constructor(privateHttp: HttpClient) { this.http = privateHttp; }
  private http: HttpClient;
  clear() { this.generation++; this.states.clear(); }
  private state(id: string) { const s=this.states.get(id); if (!s) throw new UiError("RELOAD_REQUIRED", "Yorumları yeniden yüklemelisin."); return s; }
  private async page(request: PageRequest, signal?: AbortSignal) {
    return pageOf(CommentView).parse(await this.http.request(request.endpoint, { params:{id:request.id}, query:{kind:request.kind,cursor:request.cursor,limit:"20"},signal }));
  }
  private async append(state: State, request: PageRequest, signal?: AbortSignal) {
    const page = await this.page(request, signal);
    const comments = page.data.map(mapComment);
    const pending: PageRequest[] = [];
    if (page.page.hasMore) {
      if (!page.page.nextCursor || page.page.nextCursor === request.cursor) throw new UiError("INVALID_CURSOR", "Yorum listesi yenilenmeli.");
      pending.push({...request,cursor:page.page.nextCursor});
    }
    // Replies are loaded on demand with the same explicit 'more' action.
    for (const c of page.data) if (!c.parentId && c.replyCount) pending.push({endpoint:"comments.replies",id:c.id});
    const byId = new Map(state.data.comments.map(c => [c.id,c]));
    for (const c of comments) byId.set(c.id,c);
    state.pending.push(...pending);
    state.data = {...state.data,comments:[...byId.values()],hasMore:state.pending.length>0};
  }
  async getEngagement(id: string, signal?: AbortSignal): Promise<Engagement> {
    const generation = this.generation;
    const poll = dataOf(PollDetail).parse(await this.http.request("polls.get",{params:{id},signal})).data;
    const state: State = {data:{reaction:mapReaction(poll.reactions),comments:[],hasMore:false},pending:[]};
    await this.append(state,{endpoint:"comments.list",id,kind:"COMMENT"},signal);
    await this.append(state,{endpoint:"comments.list",id,kind:"ALTERNATIVE"},signal);
    if (generation !== this.generation || signal?.aborted) throw new DOMException("Oturum değişti", "AbortError");
    this.states.set(id,state); return structuredClone(state.data);
  }
  async loadMoreEngagement(id: string): Promise<Engagement> {
    const state = this.state(id);
    const next = state.pending[0];
    if (next) {
      // Work on a copy so a failed page never loses the pending cursor or visible comments.
      const updated = structuredClone(state); updated.pending.shift();
      await this.append(updated,next);
      if (this.states.get(id) !== state) throw new UiError("RELOAD_REQUIRED", "Yorumları yeniden yüklemelisin.");
      this.states.set(id,updated); return structuredClone(updated.data);
    }
    return structuredClone(state.data);
  }
  private saveComment(id: string, comment: Comment) {
    const state=this.state(id); const comments=state.data.comments.filter(c=>c.id!==comment.id);
    state.data={...state.data,comments:[...comments,comment]}; return structuredClone(state.data);
  }
  async react(id: string, commentId: string | null, value: Reaction) {
    const state=this.state(id);
    const endpoint=`reactions.${commentId ? "comment" : "poll"}.${value ? "put" : "delete"}`;
    const reaction=mapReaction(dataOf(WireReaction).parse(await this.http.request(endpoint,{params:{id:commentId??id},body:value?{value:value.toUpperCase()}:undefined})).data);
    if (commentId) state.data={...state.data,comments:state.data.comments.map(c=>c.id===commentId?{...c,reaction}:c)};
    else state.data={...state.data,reaction};
    return structuredClone(state.data);
  }
  async addComment(id: string,draft: CommentDraft,key: string) {
    const body={body:draft.text.trim(),kind:draft.kind.toUpperCase(),...(draft.parentId?{parentId:draft.parentId}:{})};
    return this.saveComment(id,mapComment(dataOf(CommentView).parse(await this.http.request("comments.create",{params:{id},body,key})).data));
  }
  async editComment(id: string,commentId: string,text: string) {
    return this.saveComment(id,mapComment(dataOf(CommentView).parse(await this.http.request("comments.update",{params:{id:commentId},body:{body:text.trim()}})).data));
  }
  async deleteComment(id: string,commentId: string) {
    const state=this.state(id);
    await this.http.request("comments.delete",{params:{id:commentId}});
    state.data={...state.data,comments:state.data.comments.map(c=>c.id===commentId?{...c,deleted:true,text:"",author:"",canEdit:false}:c)};
    return structuredClone(state.data);
  }
}
