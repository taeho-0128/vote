import type { ErrorReason } from '../../shared/protocol.ts';

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
};
