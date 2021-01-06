import { concat, defer, Observable, of } from "rxjs";

/**
 * Observable where you can always lazily get the current value and subscribe to get changes.
 *
 * For easy downstream usage by `useObservableState` https://observable-hooks.js.org/api/#useobservablestate
 * since that requires an initial state and an on change observable
 */
export type ObservableWithInitial<T> = [() => T, Observable<T>];

/**
 * Returns an observable with the current concated with the changes
 */
export function concatInitial<T>([current, changes]: ObservableWithInitial<
  T
>): Observable<T> {
  return concat(
    defer(() => of(current())),
    changes
  );
}
