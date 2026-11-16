import type { VotePublic } from '../../shared/protocol.ts';

export const PAPER_LABEL = { freeform: '자유 기재', choice: '객관식' } as const;
export const ANONYMITY_LABEL = { anonymous: '익명', named: '기명' } as const;

export const voteKindLabel = (vote: VotePublic): string => `${PAPER_LABEL[vote.paper.kind]} · ${ANONYMITY_LABEL[vote.anonymity]}`;
