import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schemaDir = fileURLToPath(new URL('../../schema/', import.meta.url));

export function loadSchema(name: string): object {
  return JSON.parse(readFileSync(schemaDir + name, 'utf8'));
}

export function compileSchema(name: string) {
  const ajv = new Ajv2020({ strict: true, allowUnionTypes: true });
  addFormats(ajv);
  return ajv.compile(loadSchema(name));
}
