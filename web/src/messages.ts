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
  bad_display_token: '대화면 주소가 올바르지 않아요. 운영자 화면의 "대화면 열기"에서 주소를 다시 받아 주세요.',
  bad_reveal: '그 용지로는 넘길 수 없어요. 화면에 보이는 용지를 확인한 뒤 다시 눌러 주세요.',
  rate_limited: '시도가 너무 많았어요. 잠시 기다린 뒤에 다시 시도해 주세요.',
  room_expired: '방이 닫혔어요. 6시간 동안 아무 활동이 없으면 방이 사라져요.',
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

export const ROOM_CLOSED_COPY = {
  title: '방이 닫혔어요',
  reason: '6시간 동안 아무 활동이 없어서 방이 사라졌어요. 투표와 용지는 남아 있지 않아요.',
  host: '새 방을 만들어서 다시 시작할 수 있어요.',
  participant: '투표를 이어 가려면 운영자에게 새 방을 열어 달라고 해 주세요.',
  display: '운영자 화면에서 새 방을 만든 뒤 대화면 주소를 다시 받아 주세요.',
  home: '처음으로 돌아가기',
} as const;

export const RATE_LIMIT_DEFAULT_SECONDS = 60;

export const RATE_LIMIT_COPY = {
  title: '잠시 기다려 주세요',
  message: (seconds: number) => `짧은 시간에 너무 많이 시도했어요. ${seconds}초 뒤에 다시 시도할 수 있어요.`,
  ready: '이제 다시 시도할 수 있어요.',
  retry: '다시 시도',
  waiting: (seconds: number) => `${seconds}초 뒤에 다시 시도`,
} as const;

export const EXPORT_COPY = {
  heading: '내보내기',
  csv: 'CSV 내려받기',
  pdf: 'PDF로 저장',
  hintAnonymous: '익명 투표라서 파일에 닉네임이 들어가지 않아요.',
  hintNamed: '기명 투표라서 파일에 닉네임이 들어가요.',
  done: '내보냈어요',
  printBlocked: '인쇄 창이 열리지 않았어요. 브라우저의 인쇄 기능을 직접 열어 주세요.',
  confirmTitle: '아직 내보내지 않았어요',
  confirmBody: (count: number) => `새 투표를 만들면 이 투표의 용지 ${count}장은 화면에서 사라지고 다시 내보낼 수 없어요.`,
  confirmSkip: '그냥 새 투표 만들기',
} as const;

export const EXPIRY_COPY = {
  before: '계속 쓰지 않으면 방이',
  after: '뒤에 닫혀요.',
  minutes: (minutes: number) => `${minutes}분`,
  seconds: (seconds: number) => `${seconds}초`,
  now: '방이 곧 닫혀요.',
  unexported: '아직 내보내지 않은 투표가 있어요.',
  keep: '계속 사용',
  keeping: '연장하는 중…',
} as const;

export const SETTINGS_COPY = {
  label: '공개 설정',
  hiddenNow: '대화면 가림 중',
} as const;
