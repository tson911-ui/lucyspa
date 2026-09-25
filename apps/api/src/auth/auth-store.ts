// Lock primitives are shared with the worker through @lucy-spa/server; lock order:
// graph, identity/throttle, Users sorted by UUID, then Session IDs.
export {
  AUTH_GRAPH_LOCK_KEY,
  AUTH_GRAPH_LOCK_NAMESPACE,
  assertAuthTransaction,
  takeExclusiveAuthGraphLock,
  takeSharedAuthGraphLock,
} from '@lucy-spa/server';
