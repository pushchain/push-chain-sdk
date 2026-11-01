import { prePostJobUtils } from './pre-post';
import { prepareJobRead } from './read';
export const jobSpecUtils = Object.freeze({
  prePost: prePostJobUtils,
  ...prePostJobUtils,
  prepareRead: prepareJobRead,
});
export type * from './types';

export type * from './pre-post';
