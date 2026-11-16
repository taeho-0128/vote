// The submit moment as one sequence on the Web Animations API. Every length is in cqw of the stage, which is 300 units
// wide in the draft's geometry, so the same sequence plays from a 280px phone to a 420px laptop column.

export const TIMING = {
  hold: 350,
  across: 800,
  down: 700,
  slide: 1200,
  bump: 600,
  reducedMove: 380,
  reducedPulse: 240,
} as const;

const EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const SETTLE_EASE = 'cubic-bezier(0.25, 1, 0.5, 1)';
const FOLD_EASE = 'cubic-bezier(0.45, 0, 0.2, 1)';
const DROP_EASE = 'cubic-bezier(0.5, 0, 0.9, 0.6)';

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

export function playFold(parts: FoldParts, options: FoldOptions): FoldRun {
  const { scene, paper, top, flap, slip, box, count } = parts;
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

  return {
    finished,
    cancel: () => {
      cancelled = true;
      for (const animation of running) animation.cancel();
    },
  };
}
