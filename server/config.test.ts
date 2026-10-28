import { expect, test } from 'bun:test';
import { configFor } from './config';

const key = 'sk-test-configuration-fixture-12345';
test('a placeholder environment value cannot hide the configured transcription key', () => {
  const conf = configFor({ OPENAI_API_KEY: key }, { OPENAI_API_KEY: 'not-needed' });
  expect(conf('OPENAI_API_KEY', '')).toBe(key);
});
test('a valid environment key keeps precedence; missing keys never look configured', () => {
  expect(configFor({ OPENAI_API_KEY: key }, { OPENAI_API_KEY: `${key}-env` })('OPENAI_API_KEY', '')).toBe(`${key}-env`);
  expect(configFor({}, { OPENAI_API_KEY: 'not-needed' })('OPENAI_API_KEY', '')).toBe('');
  expect(configFor({ PORT: '8093' }, { PORT: '8106' })('PORT', '8090')).toBe('8106');
});
