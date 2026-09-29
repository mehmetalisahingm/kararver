// UI-only models; KV-03 will define the actual transport contract.
export type Reaction = "like" | "dislike" | null;
export type ReactionSummary = {
  likes: number;
  dislikes: number;
  own: Reaction;
};
export type CommentDraft = {
  text: string;
  kind: "comment" | "alternative";
  parentId: string | null;
};
export const emptyCommentDraft = (): CommentDraft => ({
  text: "",
  kind: "comment",
  parentId: null,
});
export type Comment = {
  id: string;
  author: string;
  text: string;
  kind: "comment" | "alternative";
  parentId: string | null;
  createdAt: string;
  edited: boolean;
  deleted: boolean;
  canEdit: boolean;
  reaction: ReactionSummary;
};
export type Engagement = { reaction: ReactionSummary; comments: Comment[] };
export interface EngagementClient {
  getEngagement(pollId: string, signal?: AbortSignal): Promise<Engagement>;
  react(
    pollId: string,
    commentId: string | null,
    value: Reaction,
  ): Promise<Engagement>;
  addComment(
    pollId: string,
    draft: CommentDraft,
    requestId: string,
  ): Promise<Engagement>;
  editComment(
    pollId: string,
    commentId: string,
    text: string,
  ): Promise<Engagement>;
  deleteComment(pollId: string, commentId: string): Promise<Engagement>;
}
export function reactionAfter(
  current: ReactionSummary,
  next: Reaction,
): ReactionSummary {
  return {
    likes:
      current.likes - Number(current.own === "like") + Number(next === "like"),
    dislikes:
      current.dislikes -
      Number(current.own === "dislike") +
      Number(next === "dislike"),
    own: next,
  };
}
