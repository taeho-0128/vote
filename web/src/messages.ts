import type { ErrorReason } from '../../shared/protocol.ts';
import { OPTION_MAX, OPTIONS_MAX, OPTIONS_MIN, TITLE_MAX } from '../../shared/vote.ts';
import type { VoteDraftError } from '../../shared/vote.ts';

// Own copy instead of the server's `message`, so every reason reads as plain Korean on the page.
export const ERROR_COPY: Record<ErrorReason, string> = {
  bad_message: '문제가 생겼어요. 새로고침한 뒤 다시 시도해 주세요.',
  already_bound: '문제가 생겼어요. 새로고침한 뒤 다시 시도해 주세요.',
  room_not_found: '방을 찾을 수 없어요. 코드를 다시 확인해 주세요.',
  room_full: '방이 가득 찼어요. 운영자에게 알려 주세요.',
  bad_host_token: '이 브라우저에서 만든 방이 아니거나 방이 닫혔어요.',
  bad_participant_token: '이전 자리를 찾지 못했어요. 닉네임을 다시 입력해 주세요.',
  nickname_invalid: '닉네임은 1~8자로 입력해 주세요.',
  nickname_taken: '이미 쓰고 있는 닉네임이에요. 다른 닉네임으로 입장해 주세요.',
  replaced: '다른 화면에서 같은 닉네임으로 입장했어요.',
  not_bound: '아직 연결이 준비되지 않았어요. 잠시 뒤에 다시 눌러 주세요.',
  not_host: '운영자만 할 수 있는 동작이에요.',
  wrong_stage: '지금 단계에서는 할 수 없는 동작이에요. 투표 상태가 바뀌었는지 확인해 주세요.',
  stale_vote: '이미 지난 투표예요. 화면에 보이는 투표를 확인한 뒤 다시 시도해 주세요.',
  bad_vote: '투표 설정이 올바르지 않아요. 제목과 보기를 확인해 주세요.',
  bad_ballot: '용지 내용이 올바르지 않아요. 내용을 확인해 주세요.',
  already_submitted: '이미 제출한 용지가 있어요.',
};

// Not an ErrorReason: the command never left the browser.
export const OFFLINE_COPY = '연결이 끊겨서 보내지 못했어요. 다시 연결되면 한 번 더 눌러 주세요.';

export const DRAFT_ERROR_COPY: Record<VoteDraftError, string> = {
  title: `제목은 1~${TITLE_MAX}자로 적어 주세요.`,
  options_count: `보기는 ${OPTIONS_MIN}~${OPTIONS_MAX}개로 만들어 주세요.`,
  option_empty: '비어 있는 보기가 있어요. 채우거나 지워 주세요.',
  option_long: `보기는 ${OPTION_MAX}자까지 적을 수 있어요.`,
  option_duplicate: '같은 보기가 있어요. 보기끼리 다르게 적어 주세요.',
};
