/**
 * callCC provides a way to escape from the inner program.
 * Different from the "real" call/CC, the CC is only valid before the callee finishes.
 * @param callback the inner program, with an argument `exit`, which can be used to escape early.
 * @returns the result of the inner program if `exit` is not called. Otherwise, the argument of `exit`.
 */
export function callCC<T>(callback: (exit: (result: T) => void) => T): T {
  const callCCBox = Symbol();
  try {
    return callback((result: T) => {
      throw { callCCBox, result };
    });
  } catch (e) {
    const errBox = e as { callCCBox?: symbol; result?: T };
    if (errBox?.callCCBox == callCCBox) {
      return errBox!.result!;
    }
    throw e;
  }
}
