import { AsyncLocalStorage } from 'async_hooks';

const userContext = new AsyncLocalStorage<string>();

export function setCurrentUserId(userId: string) {
  userContext.enterWith(userId);
}

export function getCurrentUserId() {
  return userContext.getStore() || '';
}
