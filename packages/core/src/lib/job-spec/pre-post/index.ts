import {
  buildPrePostJobSpec,
  buildPrePostJobSpecTemplate,
  encodePrePostJobSpec,
  decodePrePostJobSpec,
} from './codec';
import { describePrePostJobSpec, resolvePrePostJobSpec } from './helpers';
import { judgePrePost, previewPrePostJobSpec } from './preview';
export const prePostJobUtils = Object.freeze({
  buildJobSpec: buildPrePostJobSpec,
  buildJobSpecTemplate: buildPrePostJobSpecTemplate,
  encodeJobSpec: encodePrePostJobSpec,
  decodeJobSpec: decodePrePostJobSpec,
  describeJobSpec: describePrePostJobSpec,
  resolveJobSpec: resolvePrePostJobSpec,
  judge: judgePrePost,
  previewJobSpec: previewPrePostJobSpec,
});
export type * from './types';
