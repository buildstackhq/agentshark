import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import v2Schema from '../../schema/aspark.v2.json' with { type: 'json' };

const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });
addFormats(ajv);

const validateV2 = ajv.compile(v2Schema);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate an in-memory `.aspark` v2 file against schema/aspark.v2.json.
 * Only v2 (the format this codebase actually produces) is enforced at
 * runtime; older/hand-edited files are handled by loadReplay's own looser,
 * backwards-compatible checks instead of this schema.
 */
export function validateAsparkV2(data: unknown): ValidationResult {
  const valid = validateV2(data);
  return {
    valid,
    errors: valid ? [] : (validateV2.errors ?? []).map(e => `${e.instancePath || '/'} ${e.message}`),
  };
}
