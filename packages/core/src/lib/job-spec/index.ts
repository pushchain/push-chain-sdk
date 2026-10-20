import {
  buildJobSpec,
  buildJobSpecTemplate,
  encodeJobSpec,
  decodeJobSpec,
} from './codec';
import { describeJobSpec } from './helpers';
import { prepareJobRead } from './read';
import { unavailable } from '../market/errors';
import type {
  JobSpec,
  JobSpecTemplate,
  JobSpecPreview,
  PreviewJobSpecOptions,
} from './types';
export const jobSpecUtils = Object.freeze({
  buildJobSpec,
  buildJobSpecTemplate,
  encodeJobSpec,
  decodeJobSpec,
  describeJobSpec,
  prepareRead: prepareJobRead,
  async previewJobSpec(
    _spec: JobSpec | JobSpecTemplate,
    _options: PreviewJobSpecOptions
  ): Promise<JobSpecPreview> {
    void _spec;
    void _options;
    return unavailable(
      'Paid JobSpec preview pending the raw-read fee and callback adapter'
    );
  },
});
export type * from './types';
