import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT_DIR = join(import.meta.dirname, '../../');
const DESIGN_MD_PATH = join(ROOT_DIR, 'DESIGN.md');
const EVIDENCE_PATH = join(ROOT_DIR, '.omo/evidence/opendesign-task-1-contract.json');
const INTERACTION_EVIDENCE_PATH = join(
  ROOT_DIR,
  '.omo/evidence/task-1-game-table-interaction-redesign-contract.json'
);

export interface InteractionContractResult {
  markersFound: string[];
  markersMissing: string[];
  isValid: boolean;
}

/**
 * Amended contract markers for the table-centric interaction redesign.
 * These are exact selectors/formulas, not prose: the showcase and the
 * implementation must be able to grep DESIGN.md for each one.
 */
const INTERACTION_MARKERS = [
  'clamp(240px, 22vw, 300px)',
  '64px',
  '#btn-toggle-game-menu',
  '#btn-show-game-menu',
  'night-of-witnesses.game-menu-collapsed.v1',
  'relativeIndex = (canonicalIndex - viewerIndex + count) % count',
  '50 + Math.cos(radians) * 45',
  '50 + Math.sin(radians) * 38',
  '(x=50, y=50)',
  '.table-action-dock',
  '[data-target-id="guest-room"]',
  '.card-face',
  '.card-back',
  '玩家的隱藏卡牌',
  '#card-detail-dialog',
  '#btn-pass-card',
  '#claim-dialog',
  '#claim-role-select',
  '#btn-confirm-pass',
  '#btn-cancel-pass',
  'data-state="pending"',
  'data-state="error"',
  '.is-revealed',
  'prefers-reduced-motion',
  'simultaneously',
];

export function validateInteractionContract(content: string): InteractionContractResult {
  const markersFound: string[] = [];
  const markersMissing: string[] = [];
  for (const marker of INTERACTION_MARKERS) {
    if (content.includes(marker)) {
      markersFound.push(marker);
    } else {
      markersMissing.push(marker);
    }
  }
  return {
    markersFound,
    markersMissing,
    isValid: markersMissing.length === 0,
  };
}

export interface DesignValidationResult {
  hasAllSections: boolean;
  sectionsFound: string[];
  missingSections: string[];
  rejectedCyanTokensFound: string[];
  hasAuthoritativeRef: boolean;
  primitivesFound: string[];
  missingPrimitives: string[];
  hasNoPlaceholders: boolean;
  hasAgentChecklist: boolean;
  isValid: boolean;
}

export function validateDesignContract(content: string): DesignValidationResult {
  const mandatorySections = [
    'Atmosphere',
    'Palette & Tokens',
    'Typography',
    'Spacing & Layout Geometry',
    'Reusable Primitives & States',
    'Motion & Interaction',
    'Depth & Material',
    'Accessibility Constraints & Accepted Debt',
  ];

  const sectionsFound: string[] = [];
  const missingSections: string[] = [];

  for (const section of mandatorySections) {
    // Check if section heading exists (e.g. # Atmosphere or ## Atmosphere)
    const regex = new RegExp(`^#+\\s+.*${section.replace('&', '(&|and)')}.*$`, 'mi');
    if (regex.test(content)) {
      sectionsFound.push(section);
    } else {
      missingSections.push(section);
    }
  }

  // Cyan prototype tokens to strictly forbid
  const forbiddenCyanTokens = ['#22d3ee', '#0b1426', '#16233b', 'rgb(34, 211, 238)'];
  const rejectedCyanTokensFound: string[] = [];
  for (const token of forbiddenCyanTokens) {
    // If mentioned, only allowed if explicitly preceded or accompanied by "rejected" or "forbidden" or "not used"
    // Let's check token occurrences in token tables
    const tokenRegex = new RegExp(`(?<!rejected[\\s\\S]{0,30})${token}`, 'gi');
    // More strictly: check if token appears outside of an explicit rejection context
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.toLowerCase().includes(token.toLowerCase())) {
        if (!line.toLowerCase().includes('reject') && !line.toLowerCase().includes('forbidden')) {
          rejectedCyanTokensFound.push(token);
        }
      }
    }
  }

  const hasAuthoritativeRef =
    content.includes('design/index.html:417-440') &&
    content.includes('design/index.html:442-790') &&
    (content.includes('design/index.png') || content.includes('design/index.html'));

  const requiredPrimitives = [
    'Panel',
    'Button',
    'Field',
    'Status Badge',
    'Seat',
    'Card',
    'Transfer Box',
    'Dialog',
    'Alert',
    'Empty[\\s\\/]*Loading',
  ];

  const primitivesFound: string[] = [];
  const missingPrimitives: string[] = [];
  for (const prim of requiredPrimitives) {
    const primRegex = new RegExp(prim, 'i');
    if (primRegex.test(content)) {
      primitivesFound.push(prim);
    } else {
      missingPrimitives.push(prim);
    }
  }

  // Check for placeholders like uppercase TODO, TBD, FIXME, [placeholder]
  const placeholderRegex = /\b(TBD|FIXME|XXX|TODO)\b|\[placeholder\]/i;
  // Exclude legitimate "Todo <n>" or "Todo / Task" in headings/tables
  const filteredContent = content.replace(/\bTodo(?:\s*\d|\s*\/\s*Task)\b/gi, '');
  const hasNoPlaceholders = !placeholderRegex.test(filteredContent);

  const hasAgentChecklist =
    content.includes('Agent Checklist') &&
    content.includes('Todo 2') &&
    content.includes('Todo 3') &&
    content.includes('Todo 4') &&
    content.includes('Todo 5') &&
    content.includes('Todo 6') &&
    content.includes('Todo 7');

  const isValid =
    missingSections.length === 0 &&
    rejectedCyanTokensFound.length === 0 &&
    hasAuthoritativeRef &&
    missingPrimitives.length === 0 &&
    hasNoPlaceholders &&
    hasAgentChecklist;

  return {
    hasAllSections: missingSections.length === 0,
    sectionsFound,
    missingSections,
    rejectedCyanTokensFound,
    hasAuthoritativeRef,
    primitivesFound,
    missingPrimitives,
    hasNoPlaceholders,
    hasAgentChecklist,
    isValid,
  };
}

describe('Tavern DESIGN.md contract', () => {
  test('DESIGN.md exists and satisfies all architectural requirements', () => {
    assert.ok(existsSync(DESIGN_MD_PATH), 'DESIGN.md must exist at root');
    const content = readFileSync(DESIGN_MD_PATH, 'utf-8');
    const result = validateDesignContract(content);

    mkdirSync(join(ROOT_DIR, '.omo/evidence'), { recursive: true });
    writeFileSync(EVIDENCE_PATH, JSON.stringify(result, null, 2), 'utf-8');

    assert.equal(result.missingSections.length, 0, `Missing sections: ${result.missingSections.join(', ')}`);
    assert.equal(result.rejectedCyanTokensFound.length, 0, `Found forbidden cyan tokens: ${result.rejectedCyanTokensFound.join(', ')}`);
    assert.ok(result.hasAuthoritativeRef, 'Must cite design/index.html authoritative lines and design/index.png');
    assert.equal(result.missingPrimitives.length, 0, `Missing primitives: ${result.missingPrimitives.join(', ')}`);
    assert.ok(result.hasNoPlaceholders, 'Document must not contain TODO, TBD, FIXME, or placeholders');
    assert.ok(result.hasAgentChecklist, 'Document must contain Agent Checklist mapping UI tasks');
    assert.ok(result.isValid, 'Overall design contract must be valid');
  });

  test('validateDesignContract rejects invalid cyan tokens and missing sections in throwaway fixture', () => {
    const brokenFixture = `
# Random Title
--border: #22d3ee;
`;
    const check = validateDesignContract(brokenFixture);
    assert.equal(check.isValid, false);
    assert.ok(check.rejectedCyanTokensFound.includes('#22d3ee'));
    assert.ok(check.missingSections.length > 0);
  });
});

describe('Tavern table-centric interaction contract', () => {
  test('DESIGN.md documents the amended menu geometry, ring formula, and interaction states', () => {
    const content = readFileSync(DESIGN_MD_PATH, 'utf-8');
    const result = validateInteractionContract(content);

    mkdirSync(join(ROOT_DIR, '.omo/evidence'), { recursive: true });
    writeFileSync(INTERACTION_EVIDENCE_PATH, JSON.stringify(result, null, 2), 'utf-8');

    assert.deepEqual(
      result.markersMissing,
      [],
      `Missing interaction contract markers: ${result.markersMissing.join(', ')}`
    );
    assert.ok(result.isValid, 'Interaction contract must be complete');
  });

  test('validateInteractionContract rejects an obsolete wide-split contract fixture', () => {
    const staleContract = `
# Old layout
- Two-column grid: grid-template-columns: minmax(0, 1.5fr) minmax(360px, 0.9fr);
- Draft form uses #recipient-select and a standalone transfer box.
`;
    const check = validateInteractionContract(staleContract);
    assert.equal(check.isValid, false);
    assert.ok(check.markersMissing.includes('#claim-dialog'));
    assert.ok(check.markersMissing.includes('[data-target-id="guest-room"]'));
    assert.ok(check.markersMissing.includes('.table-action-dock'));
    assert.ok(check.markersMissing.includes('relativeIndex = (canonicalIndex - viewerIndex + count) % count'));
  });
});
