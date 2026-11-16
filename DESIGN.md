---
name: 한 표
description: 종이 용지를 접어 투표함에 넣고 한 장씩 펼치는 투표. 공공 안내판의 녹색 필드와 크림색 용지.
colors:
  field-green: "#1b5e47"
  notice-yellow: "#f5c518"
  stamp-red: "#b5301f"
  danger-red: "#a82d1c"
  ink: "#14211b"
  ink-soft: "#46564d"
  ink-dim: "#5a6a60"
  rule: "#7f8f84"
  screen-bg: "#f3f5ef"
  page-bg: "#e8ebe4"
  panel: "#ffffff"
  chip-bg: "#eef1ea"
  segment-bg: "#dfe5db"
  paper: "#f8f2e2"
  paper-back: "#efe7d1"
  paper-ink: "#1d2330"
  paper-rule: "rgba(60, 90, 130, 0.26)"
  warn-bg: "#fff6cf"
  warn-line: "#d9aa00"
  warn-ink: "#7a5b00"
  steel-box: "#aab5b0"
  steel-box-deep: "#869590"
  focus-ring: "#0b57d0"
typography:
  display:
    fontFamily: "'Black Han Sans', 'Noto Sans KR', sans-serif"
    fontWeight: 400
    lineHeight: 1.15
  body:
    fontFamily: "'Noto Sans KR', system-ui, sans-serif"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "'Noto Sans KR', system-ui, sans-serif"
    fontWeight: 700
  hand:
    fontFamily: "'Nanum Pen Script', cursive"
    fontWeight: 400
rounded:
  sm: "6px"
  lg: "10px"
spacing:
  appbar-height: "56px"
components:
  button-primary:
    backgroundColor: "{colors.field-green}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    height: "50px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "50px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  paper:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper-ink}"
    rounded: "3px"
---

# Design System: 한 표

## Overview

**Creative North Star: "투표소 안내판"**

공공 안내판처럼 읽기 쉬운 녹색 필드 위에 크림색 종이 한 장이 놓인다. 화면은 도구처럼 분명하고, 용지와 투표함만이 손으로 만진 물건처럼 표현된다. 튀는 것은 용지를 접어 넣는 한 번의 연출뿐이고, 나머지는 읽히는 것에 쓴다.

운영자 화면은 익숙한 컨트롤(버튼, 스위치, 탭, 입력칸)로 이루어진 작업 도구이고, 세계관은 색, 글꼴, 밀도, 그리고 하나의 시그니처(명부에 찍히는 인주 도장)로만 들어온다. 대화면은 방 뒤쪽에서 읽혀야 하므로 글자가 크고 위계가 단순하다.

**Key Characteristics:**
- 녹색 필드(안내판)와 크림색 용지의 대비가 중심이다.
- 굵은 한글 고딕(Black Han Sans)이 제목과 큰 숫자를 맡고, 손글씨체(Nanum Pen Script)는 용지 위에서만 쓴다.
- 직각에 가까운 작은 반경과 부드럽고 작은 그림자를 쓴다. 유리, 그라디언트, 단단한 옵셋 그림자는 쓰지 않는다.
- 붉은 인주 색은 "확" 도장 하나와 오류에만 쓴다.

## Colors

- **안내판 녹색** (`#1b5e47`): 앱바, 기본 버튼, 대화면 바탕, 투표함 이름표. 화면의 중심 색이고 면으로 쓴다.
- **안내 노랑** (`#f5c518`): 선택, 아직 안 낸 사람, 익명 안내 배지, 객관식의 최다 득표. 노랑 위의 글자는 항상 `ink`다.
- **인주 빨강** (`#b5301f`): 제출 도장 한 곳. 오류는 `#a82d1c`와 `#fdecea` 바탕이다.
- **잉크**: 본문 `#14211b`, 보조 `#46564d`, 희미한 `#5a6a60`. 어느 것도 흰 바탕에서 4.5:1을 넘긴다.
- **종이**: `#f8f2e2` 바탕에 `rgba(60, 90, 130, 0.26)` 괘선, 글씨 `#1d2330`. 접힌 뒷면은 `#efe7d1`이다.
- **경고**: 노란 바탕 `#fff6cf`, 선 `#d9aa00`, 글자 `#7a5b00`. 만료 경고 띠와 가득 찼다는 안내에 쓴다.
- **포커스**: 밝은 바탕에서 `#0b57d0`, 어두운 바탕에서 `#ffd54a`.

## Typography

- **display** Black Han Sans: 화면 제목, 방 코드 숫자, 대화면의 큰 숫자와 제목. 가운데 정렬이나 자간 조정으로 꾸미지 않는다.
- **body** Noto Sans KR: 모든 설명과 컨트롤. 본문은 줄 높이 1.55를 쓴다.
- **label** Noto Sans KR 700: 버튼, 스위치 이름, 작은 제목.
- **hand** Nanum Pen Script: 용지 위의 글, 객관식 보기, 서명에만 쓴다. 용지 안의 글씨 크기는 글자 수와 줄 수에 따라 단계적으로 줄어들어 항상 용지 안에 다 보인다(`web/src/textFit.ts`).
- 대화면의 글자는 화면 너비에 비례해 커지고, 긴 제목은 단어 중간에서 끊지 않는다.

## Layout

- 참가자 화면은 폰 우선이고 넓은 화면에서는 가운데의 좁은 열(약 480px)이다.
- 운영자 화면은 폰(720px 미만)에서 한 열이고 액션은 아래 고정 바에 있다. 720~1023px는 가운데 640px 열이다. 1024px부터 두 열이고 액션은 위 바에 있다.
- 대화면은 16:9 한 장면을 창에 맞춰 키우고, 모든 크기는 한 단위(`--u`, 가로의 1%)에서 나온다.
- 터치 대상은 44px 이상이다.
- 앱바 높이는 56px이다.

## Elevation & Depth

그림자는 작고 부드러운 두 겹이다(`0 1px 2px` 과 `0 2px 6px`). 용지는 조금 더 높이 뜬다(`0 1px 1px` 과 `0 8px 18px`, 갈색 계열). 투표함은 강철 회색의 위아래 그라디언트 면과 아래쪽 그림자로 입체를 준다. 그 밖의 깊이는 색 면의 차이로 낸다.

## Shapes

작은 반경(6px)과 패널 반경(10px). 용지는 거의 직각(3px)이다. 칩은 알약이다. 투표함의 뚜껑은 몸통보다 조금 넓고, 가운데에 가는 슬롯이 있다.

## Components

- **버튼**: 기본은 녹색 면에 흰 글자이고 높이 50px(작은 것은 40px)이다. 고스트는 투명 바탕에 1.5px 윤곽이다. 비활성은 투명도를 낮추고 그림자를 뺀다. 눌리면 1px 내려간다.
- **패널**: 흰 바탕, 10px 반경, 작은 그림자. 패널 안에 패널을 넣지 않는다.
- **스위치와 구간 선택**: 켜면 녹색(스위치)이나 흰 바탕(구간)이 된다. 모든 스위치는 `role="switch"`다.
- **방 코드 입력**: 숫자 하나씩 4칸. 한 칸은 72px 높이, display 글꼴이다.
- **명부 칩**: 아직 안 낸 사람은 노랑 바탕, 낸 사람은 연한 바탕에 붉은 "확" 도장이다. 도장은 한 번 찍히는 짧은 연출이다.
- **용지**: 크림색 괘선 용지, 3:4 비율. 쓰는 용지, 접히는 용지, 펼치는 용지, 인쇄 용지는 같은 `PaperFace` 하나로 그린다.
- **투표함**: 강철 회색 상자에 녹색 이름표. 이름표에 "투표함"과 숫자가 있다.
- **대화면**: 녹색 바탕, 흰 글자, 노랑으로 강조. 막대 그래프는 가로이고 최다 득표만 노랑이며 "최다" 표시가 붙는다.
- **경고 띠와 안내**: 노랑 경고 색 면에 아이콘과 글. 색 띠를 한쪽에만 붙이지 않는다.

## Do's and Don'ts

**Do**
- 접기와 펼치기를 하나의 연출로 한 번만 보여준다. 지수 감속 곡선을 쓴다.
- 익명 투표의 공개 화면에는 닉네임을 어디에도 쓰지 않는다. 화면 코드가 아니라 서버 스냅샷이 막는다.
- 모든 상태(비어 있음, 하나뿐, 마지막, 가림, 오류, 재접속)를 실제 글로 보여준다.
- 움직임 줄이기에서는 접기를 생략하고 짧은 페이드로 바꾼다.

**Don't**
- 한쪽에만 두꺼운 색 띠를 붙인 카드나 안내를 만들지 않는다.
- 그라디언트 글자, 유리 효과, 단단한 옵셋 그림자, 이모지 아이콘을 쓰지 않는다.
- 같은 크기의 아이콘 카드를 줄지어 세우지 않는다.
- "완전 익명" 같은 단정을 하지 않는다.
- 효과음을 넣지 않는다.
