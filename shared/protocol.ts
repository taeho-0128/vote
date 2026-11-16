import { z } from 'zod';

export const ROOM_CODE_PATTERN = /^\d{4}$/;

export const roomCodeSchema = z.string().regex(ROOM_CODE_PATTERN);
export const tokenSchema = z.string().min(16).max(64);

export const stageSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('lobby') })]);

export const participantSummarySchema = z.object({
  id: z.string(),
  nickname: z.string(),
  connected: z.boolean(),
});

export const hostViewSchema = z.object({
  role: z.literal('host'),
  code: roomCodeSchema,
  stage: stageSchema,
  participants: z.array(participantSummarySchema),
});

export const participantViewSchema = z.object({
  role: z.literal('participant'),
  code: roomCodeSchema,
  stage: stageSchema,
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
]);

export const serverMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hosted'), hostToken: tokenSchema, view: hostViewSchema }),
  z.object({ t: z.literal('joined'), participantToken: tokenSchema, view: participantViewSchema }),
  z.object({ t: z.literal('view'), view: viewSchema }),
  z.object({ t: z.literal('error'), reason: errorReasonSchema, message: z.string() }),
]);

export type Stage = z.infer<typeof stageSchema>;
export type ParticipantSummary = z.infer<typeof participantSummarySchema>;
export type HostView = z.infer<typeof hostViewSchema>;
export type ParticipantView = z.infer<typeof participantViewSchema>;
export type View = z.infer<typeof viewSchema>;
export type ClientMsg = z.infer<typeof clientMsgSchema>;
export type ServerMsg = z.infer<typeof serverMsgSchema>;
export type ErrorReason = z.infer<typeof errorReasonSchema>;
