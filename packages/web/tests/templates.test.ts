import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../app/dev/templates';
import type { Template } from '../app/dev/templates';

describe('TEMPLATES', () => {
  it('has at least 3 templates', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(3);
  });

  it.each(TEMPLATES.map(t => [t.id, t] as const))('%s has required fields', (_id, template: Template) => {
    expect(template.id).toBeTruthy();
    expect(template.name).toBeTruthy();
    expect(template.description).toBeTruthy();
    expect(template.tech).toBeTruthy();
    expect(template.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(Object.keys(template.files).length).toBeGreaterThan(0);
  });

  it.each(TEMPLATES.map(t => [t.id, t] as const))('%s has a package.json', (_id, template: Template) => {
    expect(template.files['package.json']).toBeDefined();
  });

  it.each(TEMPLATES.map(t => [t.id, t] as const))('%s has {{PROJECT_NAME}} placeholder', (_id, template: Template) => {
    const packageJson = template.files['package.json'];
    expect(packageJson).toContain('{{PROJECT_NAME}}');
  });

  it.each(TEMPLATES.map(t => [t.id, t] as const))('%s has @byoky/sdk dependency', (_id, template: Template) => {
    const packageJson = template.files['package.json'];
    expect(packageJson).toContain('@byoky/sdk');
  });

  it.each(TEMPLATES.map(t => [t.id, t] as const))('%s has a README', (_id, template: Template) => {
    expect(template.files['README.md']).toBeDefined();
  });

  it('has unique IDs', () => {
    const ids = TEMPLATES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique names', () => {
    const names = TEMPLATES.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('all template package.json files are valid JSON', () => {
    for (const template of TEMPLATES) {
      const pkgJson = template.files['package.json'].replace(/\{\{PROJECT_NAME\}\}/g, 'test-app');
      expect(() => JSON.parse(pkgJson)).not.toThrow();
    }
  });
});
