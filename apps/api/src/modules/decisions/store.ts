export type Decision = { pollId: string; chosenOptionId: string | null; note: string; updatedAt: Date };
export type DecisionStore = {
 get(pollId: string, viewerId: string | null): Promise<{ decision: Decision | null; following: boolean; isAuthor: boolean } | null>;
 follow(pollId: string, userId: string, following: boolean): Promise<void>;
 put(pollId: string, userId: string, input: { chosenOptionId: string | null; note: string }, now: Date,
 authorize: (resource: { ownerId: string }) => Promise<void>): Promise<Decision>;
};
