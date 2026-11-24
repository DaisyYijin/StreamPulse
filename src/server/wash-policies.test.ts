import { describe, expect, it } from 'vitest';
import { evaluateWashPolicies, parseWashPolicies } from './wash-policies.js';

const yaml = `电影洗版策略:
  mode: replace
  media_type: movie
  priority_level:
    - resource_team: "WiKi"
      resource_effect: "!DV"
    - resource_pix: "2160p,4k"
      resource_type: "BluRay"
    - resource_pix: "1080p"
电影兜底:
  mode: max_size
  media_type: movie
`;

describe('wash policies', () => {
  it('parses named policies and rejects invalid modes', () => {
    const policies = parseWashPolicies(yaml);
    expect(policies.map((policy) => policy.name)).toEqual(['电影洗版策略', '电影兜底']);
    expect(() => parseWashPolicies('x:\n  mode: nope')).toThrow();
  });

  it('upgrades when the candidate has higher priority', () => {
    const policies = parseWashPolicies(yaml);
    const decision = evaluateWashPolicies(policies, {
      mediaType: 'movie', category: '电影',
      candidateName: 'Movie.2024.2160p.BluRay.mkv', candidateSize: 20,
      existingName: 'Movie.2024.1080p.WEB-DL.mkv', existingSize: 10,
    });
    expect(decision?.action).toBe('upgrade');
  });

  it('does not upgrade a DV candidate for the WiKi rule', () => {
    const policies = parseWashPolicies(yaml);
    const decision = evaluateWashPolicies(policies, {
      mediaType: 'movie', category: '电影',
      candidateName: 'Movie.2024.2160p.DV.WiKi.mkv', candidateSize: 20,
      existingName: 'Movie.2024.2160p.BluRay.mkv', existingSize: 10,
    });
    expect(decision?.action).not.toBe('upgrade');
  });
});
