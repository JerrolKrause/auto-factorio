import { describe, expect, it } from 'vitest';
import { readPrompt, renderPrompt } from '../agents/prompts.js';
import {
  foreman, engineer, solo, workshopDesigner, workshopScorer, workshopLearnings, workshopPrivateComparison,
} from '../packages/core/orchestration/roles.js';

const promptRoles: Array<{ role: string; section: string; values?: Record<string, string | number> }> = [
  { role: 'foreman', section: 'instructions' },
  { role: 'engineer', section: 'instructions' },
  { role: 'solo', section: 'instructions', values: { foreman: foreman.instructions, engineer: engineer.instructions } },
  { role: 'shared/gameplay', section: 'output' },
  { role: 'shared/workshop', section: 'output' },
  { role: 'shared/provider', section: 'identity', values: { role: 'engineer' } },
  { role: 'developer/author', section: 'task', values: {
    taskId: '2.1', description: 'Implement slice', tasksFile: 'openspec/change/tasks.md', escalateWhen: 'evidence conflicts',
  } },
  { role: 'workshop/designer', section: 'cell-design' },
  { role: 'workshop/scorer', section: 'role' },
  { role: 'workshop/learnings', section: 'role' },
  { role: 'workshop/private-comparison', section: 'role' },
  { role: 'diagnostics/provider', section: 'instructions', values: { role: 'foreman' } },
  { role: 'diagnostics/workshop', section: 'designer-turn', values: { attempt: 1, objective: 'Plan safely.', attemptTag: '01' } },
];

describe('agent prompt loader', () => {
  it('rejects missing, empty, and duplicate sections', () => {
    expect(() => renderPrompt('## present\ncontent', 'absent')).toThrow(/Missing or empty prompt section/);
    expect(() => renderPrompt('## empty\n \n## other\ncontent', 'empty')).toThrow(/Missing or empty prompt section/);
    expect(() => renderPrompt('## repeated\none\n## repeated\ntwo', 'repeated')).toThrow(/Duplicate prompt section/);
  });

  it('rejects missing template values and values unused by the section', () => {
    expect(() => renderPrompt('## body\nHello {{name}}', 'body')).toThrow(/Missing prompt value: name/);
    expect(() => renderPrompt('## body\nHello', 'body', { name: 'Ada' })).toThrow(/Unused prompt value: name/);
  });

  it('substitutes values once, preserves zero, and parses CRLF Markdown', () => {
    const markdown = '## greeting\r\nHello {{name}}\r\nCount {{count}}';
    expect(renderPrompt(markdown, 'greeting', { name: '{{other}}', count: 0 })).toBe('Hello {{other}}\nCount 0');
  });

  it.each(['../foreman', 'foreman/../../engineer', '/foreman', 'foreman\\..\\engineer', ''])('rejects invalid role path %j', role => {
    expect(() => readPrompt(role, 'instructions')).toThrow(/Invalid prompt role/);
  });

  it.each(promptRoles)('loads the source prompt for $role/$section', ({ role, section, values }) => {
    expect(readPrompt(role, section, values).trim().length).toBeGreaterThan(0);
  });

  it('renders current templates with the values supplied by their runtime call sites', () => {
    expect(readPrompt('diagnostics/provider', 'instructions', { role: 'foreman' })).toContain("synthetic foreman");
    expect(readPrompt('shared/provider', 'identity', { role: 'engineer' }))
      .toContain('Role: engineer.');
    expect(readPrompt('developer/author', 'task', {
      taskId: '2.1', description: 'Implement slice', tasksFile: 'openspec/change/tasks.md', escalateWhen: 'evidence conflicts',
    })).toContain('Apply authorized OpenSpec task 2.1: Implement slice\nUse openspec/change/tasks.md and the linked change artifacts. Escalate when: evidence conflicts.');
    expect(readPrompt('workshop/designer', 'turn', {
      iteration: 0, repetition: 'repeat safely', cellDesign: 'trace every path', sourceRevision: '',
    })).toContain('Design attempt 0. repeat safely trace every path');
    expect(readPrompt('workshop/designer', 'turn', {
      iteration: 2, repetition: 'repeat', cellDesign: 'inspect', sourceRevision: ' Revision abc',
    })).toContain('Revision abc');
    expect(readPrompt('workshop/designer', 'instructions', { activatedInstructions: '\nKeep the public assignment fixed.' }))
      .toContain('Do not use markdown outside the JSON object.\nKeep the public assignment fixed.');
    expect(readPrompt('shared/workshop', 'activated-instructions', { instructions: 'Use the approved checklist.' }))
      .toContain('Activated instructions:\nUse the approved checklist.');
    expect(readPrompt('workshop/scorer', 'turn', { candidateRef: 'candidate-1', evaluationRef: 'evaluation-1' }))
      .toContain('candidateRef "candidate-1" and evaluationRef "evaluation-1"');
    expect(readPrompt('workshop/scorer', 'instructions', { activatedInstructions: '\nKeep evidence immutable.' }))
      .toContain('score fields as immutable.\nKeep evidence immutable.');
    expect(readPrompt('diagnostics/workshop', 'designer-turn', { attempt: 3, objective: 'Plan a belt.', attemptTag: '03' }))
      .toContain('Attempt 3 of exactly 5. Plan a belt. Return a concise plan tagged ATTEMPT_03.');
    expect(readPrompt('diagnostics/workshop', 'designer-instructions', { assignment: 'iron plates at 2/s' }))
      .toContain('The fixed assignment is iron plates at 2/s.');
    expect(readPrompt('diagnostics/workshop', 'reviewer-turn', {
      incumbent: '61', candidate: '61', control: '60', fs: 'false', network: 'false', child: 'false',
    })).toContain('reported false/false/false');
  });

  it('wires loaded source prompts into gameplay and workshop role definitions', () => {
    expect(foreman.instructions).toBe(readPrompt('foreman', 'instructions'));
    expect(engineer.instructions).toBe(readPrompt('engineer', 'instructions'));
    expect(solo.instructions).toBe(readPrompt('solo', 'instructions', {
      foreman: foreman.instructions, engineer: engineer.instructions,
    }));
    expect(workshopDesigner.instructions).toBe(readPrompt('workshop/designer', 'role'));
    expect(workshopScorer.instructions).toBe(readPrompt('workshop/scorer', 'role'));
    expect(workshopLearnings.instructions).toBe(readPrompt('workshop/learnings', 'role'));
    expect(workshopPrivateComparison.instructions).toBe(readPrompt('workshop/private-comparison', 'role'));
    expect(foreman.output).toBe(readPrompt('shared/gameplay', 'output'));
    expect(workshopDesigner.output).toBe(readPrompt('shared/workshop', 'output'));
  });
});
