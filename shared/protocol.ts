import { z } from 'zod';
import { anonymitySchema, ballotContentSchema, paperSchema, voteDraftSchema } from './vote.ts';

export const ROOM_CODE_PATTERN = /^\d{4}$/;

export const roomCodeSchema = z.string().regex(ROOM_CODE_PATTERN);
export const tokenSchema = z.string().min(16).max(64);

export const votePublicSchema = z.object({
  id: z.string(),
  title: z.string(),
  anonymity: anonymitySchema,
  paper: paperSchema,
});

const lobbyStage = z.object({ kind: z.literal('lobby') });

export const hostStageSchema = z.discriminatedUnion('kind', [
  lobbyStage,
  z.object({ kind: z.literal('voting'), vote: votePublicSchema, submittedCount: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('closed'), vote: votePublicSchema, ballotCount: z.number().int().nonnegative() }),
]);

export const participantStageSchema = z.discriminatedUnion('kind', [
  lobbyStage,
  z.object({ kind: z.literal('voting'), vote: votePublicSchema, submitted: z.boolean() }),
  z.object({ kind: z.literal('closed'), vote: votePublicSchema, submitted: z.boolean() }),
]);

export const participantSummarySchema = z.object({
  id: z.string(),
  nickname: z.string(),
  connected: z.boolean(),
});

export const hostParticipantSchema = participantSummarySchema.extend({ submitted: z.boolean() });

export const hostViewSchema = z.object({
  role: z.literal('host'),
  code: roomCodeSchema,
  stage: hostStageSchema,
  participants: z.array(hostParticipantSchema),
});

export const participantViewSchema = z.object({
  role: z.literal('participant'),
  code: roomCodeSchema,
  stage: participantStageSchema,
  me: z.object({ id: z.string(), nickname: z.string() }),
  participants: z.array(participantSummarySchema),
});

export const viewSchema = z.discriminatedUnion('role', [hostViewSchema, participantViewSchema]);

export const clientMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('createRoom') }),
  z.object({ t: z.literal('resumeHost'), code: roomCodeSchema, hostToken: tokenSchema }),
  z.object({
    t: z.literal('join'),
    code: roomCodeSchema,
    nickname: z.string().max(64),
    participantToken: tokenSchema.optional(),
  }),
  z.object({ t: z.literal('startVote'), draft: voteDraftSchema }),
  z.object({ t: z.literal('closeVote'), voteId: z.string() }),
  z.object({ t: z.literal('dismissVote'), voteId: z.string() }),
  z.object({ t: z.literal('submitBallot'), voteId: z.string(), content: ballotContentSchema }),
]);

export const errorReasonSchema = z.enum([
  'bad_message',
  'already_bound',
  'room_not_found',
  'room_full',
  'bad_host_token',
  'bad_participant_token',
  'nickname_invalid',
  'nickname_taken',
  'replaced',
  'not_bound',
  'not_host',
  'wrong_stage',
  'stale_vote',
  'bad_vote',
  'bad_ballot',
  'already_submitted',
]);

export const serverMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hosted'), hostToken: tokenSchema, view: hostViewSchema }),
  z.object({ t: z.literal('joined'), participantToken: tokenSchema, view: participantViewSchema }),
  z.object({ t: z.literal('view'), view: viewSchema }),
  z.object({ t: z.literal('error'), reason: errorReasonSchema, message: z.string() }),
]);

export type VotePublic = z.infer<typeof votePublicSchema>;
export type HostStage = z.infer<typeof hostStageSchema>;
export type ParticipantStage = z.infer<typeof participantStageSchema>;
export type ParticipantSummary = z.infer<typeof participantSummarySchema>;
export type HostParticipant = z.infer<typeof hostParticipantSchema>;
export type HostView = z.infer<typeof hostViewSchema>;
export type ParticipantView = z.infer<typeof participantViewSchema>;
export type View = z.infer<typeof viewSchema>;
export type ClientMsg = z.infer<typeof clientMsgSchema>;
export type ServerMsg = z.infer<typeof serverMsgSchema>;
export type ErrorReason = z.infer<typeof errorReasonSchema>;
