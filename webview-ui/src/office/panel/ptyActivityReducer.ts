import { PTY_ACTIVITY_HOLD_MS } from '../../constants.js';

export interface PtyActivityState {
  /** ms-since-epoch of the most recent bump */
  lastActivityAt: number;
  /** ms-since-epoch until which the character should be considered typing */
  ptyActivityUntil: number;
}

export type PtyActivityAction = { type: 'bump'; now: number } | { type: 'reset' };

export const ptyActivityInitialState: PtyActivityState = {
  lastActivityAt: 0,
  ptyActivityUntil: 0,
};

/** Pure reducer: a 'bump' action with a newer timestamp pushes the deadline
 *  forward by PTY_ACTIVITY_HOLD_MS; an older-or-equal timestamp is ignored
 *  (defensive against out-of-order delivery). 'reset' returns to initial. */
export function ptyActivityReducer(
  state: PtyActivityState,
  action: PtyActivityAction,
): PtyActivityState {
  switch (action.type) {
    case 'bump':
      if (action.now <= state.lastActivityAt) return state;
      return {
        lastActivityAt: action.now,
        ptyActivityUntil: action.now + PTY_ACTIVITY_HOLD_MS,
      };
    case 'reset':
      return ptyActivityInitialState;
  }
}
