// The submit moment as one sequence on the Web Animations API. Every length is in cqw of the stage, which is 300 units
// wide in the draft's geometry, so the same sequence plays from a 280px phone to a 420px laptop column. The results
// screens play the same pieces backwards: a slip opens one way, then the other, and settles as the paper.

export const TIMING = {
  hold: 350,
  across: 800,
  down: 700,
  slide: 1200,
  bump: 600,
  reducedMove: 380,
  reducedPulse: 240,
  come: 560,
  open: 440,
  spread: 640,
  fadeIn: 240,
  fadeOut: 180,
} as const;

const EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const SETTLE_EASE = 'cubic-bezier(0.25, 1, 0.5, 1)';
const FOLD_EASE = 'cubic-bezier(0.45, 0, 0.2, 1)';
const DROP_EASE = 'cubic-bezier(0.5, 0, 0.9, 0.6)';
const OPEN_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

// 1 unit of the draft's 300px-wide stage.
const u = (n: number) => `${(n / 3).toFixed(3)}cqw`;

export interface FoldParts {
  scene: HTMLElement;
  paper: HTMLElement;
  top: HTMLElement;
  flap: HTMLElement;
  slip: HTMLElement;
  box: HTMLElement;
  count: HTMLElement;
}

export interface FoldOptions {
  reduced: boolean;
  // Where the writing paper was on screen, for the first settle into the stage. Null skips it.
  from: { left: number; top: number; width: number; height: number } | null;
  // The slip is in the box. The caller shows the new count here.
  onLand: () => void;
}

export interface FoldRun {
  // Resolves true once the whole sequence played, false when it was cancelled first.
  readonly finished: Promise<boolean>;
  cancel: () => void;
}

export function buzz(): void {
  try {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(30);
  } catch {
    /* a browser that refuses the call is a device without haptics */
  }
}

// Animations that belong to one run. Cancelling the run cancels every one of them, and `play` answers false for any
// that did not finish, so a sequence stops at the first step a cancel interrupts.
function runner() {
  const running = new Set<Animation>();
  let cancelled = false;

  const animate = (el: HTMLElement, keyframes: Keyframe[], timing: KeyframeAnimationOptions): Animation => {
    const animation = el.animate(keyframes, { fill: 'both', ...timing });
    running.add(animation);
    return animation;
  };

  const play = async (animation: Animation): Promise<boolean> => {
    try {
      await animation.finished;
    } catch {
      return false;
    }
    return !cancelled;
  };

  const cancel = () => {
    cancelled = true;
    for (const animation of running) animation.cancel();
  };

  return { animate, play, cancel };
}

export function playFold(parts: FoldParts, options: FoldOptions): FoldRun {
  const { scene, paper, top, flap, slip, box, count } = parts;
  const { animate, play, cancel } = runner();

  const land = () => {
    options.onLand();
    buzz();
  };

  const settle = () => {
    const { from } = options;
    if (from === null || options.reduced) return;
    const to = paper.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    animate(
      paper,
      [{ transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width})` }, { transform: 'none' }],
      { duration: TIMING.hold + 250, easing: SETTLE_EASE },
    );
  };

  const reducedRun = async (): Promise<boolean> => {
    scene.dataset.step = 'paper';
    const move = animate(
      paper,
      [
        { transform: 'none', opacity: 1 },
        { transform: `translateY(${u(130)}) scale(0.5)`, opacity: 0 },
      ],
      { duration: TIMING.reducedMove, easing: EXPO_OUT },
    );
    if (!(await play(move))) return false;
    scene.dataset.step = 'landed';
    land();
    return play(animate(count, [{ opacity: 0.3 }, { opacity: 1 }], { duration: TIMING.reducedPulse, easing: EXPO_OUT }));
  };

  const fullRun = async (): Promise<boolean> => {
    scene.dataset.step = 'paper';
    settle();
    const across = animate(top, [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-180deg)' }], {
      delay: TIMING.hold,
      duration: TIMING.across,
      easing: FOLD_EASE,
    });
    if (!(await play(across))) return false;

    scene.dataset.step = 'strip';
    const down = animate(flap, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }], {
      duration: TIMING.down,
      easing: FOLD_EASE,
    });
    if (!(await play(down))) return false;

    scene.dataset.step = 'slip';
    const slide = animate(
      slip,
      [
        { transform: 'translate(0, 0) rotate(0deg)', easing: EXPO_OUT },
        { transform: `translate(${u(-38)}, ${u(-10)}) rotate(-5deg) scale(0.95)`, offset: 0.3, easing: 'ease-in-out' },
        { transform: `translate(${u(-38)}, ${u(22)}) rotate(0deg) scale(0.9)`, offset: 0.55, easing: DROP_EASE },
        { transform: `translate(${u(-38)}, ${u(172)}) rotate(0deg) scale(0.9)` },
      ],
      { duration: TIMING.slide },
    );
    if (!(await play(slide))) return false;

    scene.dataset.step = 'landed';
    land();
    animate(count, [{ transform: `translateY(${u(8)})`, opacity: 0 }, { transform: 'none', opacity: 1 }], {
      duration: 300,
      easing: EXPO_OUT,
    });
    const bump = animate(
      box,
      [
        { transform: 'none', offset: 0, easing: 'ease-out' },
        { transform: `translateY(${u(4)}) scale(1.02, 0.97)`, offset: 0.2, easing: 'ease-out' },
        { transform: 'none', offset: 0.55 },
        { transform: 'none' },
      ],
      { duration: TIMING.bump },
    );
    return play(bump);
  };

  const finished = options.reduced ? reducedRun() : fullRun();

  return { finished, cancel };
}

export interface UnfoldParts {
  root: HTMLElement;
  top: HTMLElement;
  flap: HTMLElement;
  slip: HTMLElement;
}

export interface UnfoldOptions {
  // The slip the paper is taken from, as it sits on screen. Null grows the slip in place instead.
  from: { left: number; top: number; width: number; height: number } | null;
}

// The fold backwards: the slip comes forward from its pile, the flap opens one way, the top opens the other, and the
// next frame is the settled paper. Every step starts from the pose the step before it ended in.
export function playUnfold(parts: UnfoldParts, options: UnfoldOptions): FoldRun {
  const { root, top, flap, slip } = parts;
  const { animate, play, cancel } = runner();

  const come = (): Animation => {
    const { from } = options;
    if (from === null) {
      return animate(slip, [{ transform: 'scale(0.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
        duration: TIMING.come,
        easing: EXPO_OUT,
      });
    }
    const to = slip.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    return animate(
      slip,
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width}) rotate(-6deg)`, offset: 0, easing: EXPO_OUT },
        { transform: `translate(${dx * 0.1}px, ${dy * 0.1}px) scale(1.05) rotate(-1deg)`, offset: 0.65, easing: OPEN_EASE },
        { transform: 'none', offset: 1 },
      ],
      { duration: TIMING.come },
    );
  };

  const finished = (async (): Promise<boolean> => {
    root.dataset.step = 'slip';
    if (!(await play(come()))) return false;

    root.dataset.step = 'strip';
    const open = animate(flap, [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }], {
      duration: TIMING.open,
      easing: OPEN_EASE,
    });
    if (!(await play(open))) return false;

    root.dataset.step = 'paper';
    const spread = animate(top, [{ transform: 'rotateX(-180deg)' }, { transform: 'rotateX(0deg)' }], {
      duration: TIMING.spread,
      easing: OPEN_EASE,
    });
    return play(spread);
  })();

  return { finished, cancel };
}

export function playFade(el: HTMLElement, direction: 'in' | 'out'): FoldRun {
  const { animate, play, cancel } = runner();
  const entering = direction === 'in';
  const animation = animate(el, [{ opacity: entering ? 0 : 1 }, { opacity: entering ? 1 : 0 }], {
    duration: entering ? TIMING.fadeIn : TIMING.fadeOut,
    easing: EXPO_OUT,
  });
  return { finished: play(animation), cancel };
}
