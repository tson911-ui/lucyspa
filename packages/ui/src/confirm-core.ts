// State machine behind ConfirmDialog (docs/UXUI_REDESIGN_DESIGN.md 11). DOM-free so the safety
// rules are unit tested: nothing is sent until confirm, no double submit, a refusal keeps the
// dialog open, and a busy dialog cannot be dismissed.

export interface ConfirmState {
  pending: boolean;
  /** The last refusal, or `null`. */
  error: unknown;
}

export const idleConfirm: ConfirmState = { pending: false, error: null };

export interface ConfirmController {
  readonly state: ConfirmState;
  /** Cancel, Escape or backdrop. Returns `false` (and does nothing) while a request is running. */
  cancel: () => boolean;
  /** Runs `onConfirm` once. Resolves `true` on success, `false` when refused or already running. */
  confirm: (reason?: string) => Promise<boolean>;
}

export function createConfirmController(options: {
  onConfirm: (reason?: string) => Promise<void>;
  onCancel: () => void;
  onChange: (state: ConfirmState) => void;
}): ConfirmController {
  let state = idleConfirm;
  const set = (next: ConfirmState) => {
    state = next;
    options.onChange(state);
  };
  return {
    get state() {
      return state;
    },
    cancel() {
      if (state.pending) return false;
      options.onCancel();
      return true;
    },
    async confirm(reason) {
      if (state.pending) return false;
      set({ pending: true, error: null });
      try {
        await options.onConfirm(reason);
        // The owner unmounts the dialog on success; staying busy blocks a second submit meanwhile.
        return true;
      } catch (failure) {
        set({ pending: false, error: failure });
        return false;
      }
    },
  };
}

/** Whether the confirm button may be pressed for a "type the code to confirm" dialog. */
export function typingMatches(typed: string, code: string): boolean {
  return typed.trim() === code;
}
