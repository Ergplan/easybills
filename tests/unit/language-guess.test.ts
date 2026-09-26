import { describe, expect, it } from 'vitest';

import { guessLanguage } from '@/lib/domain/language-guess';

describe('guessing the language', () => {
  it('reads a surname', () => {
    expect(guessLanguage({ name: 'Ramesh Patil' })).toEqual({ language: 'mr', reason: 'name', because: 'Patil' });
    expect(guessLanguage({ name: 'Nilesh Patel' })?.language).toBe('gu');
    expect(guessLanguage({ name: 'S. Murugan' })?.language).toBe('ta');
    expect(guessLanguage({ name: 'Srinivas Reddy' })?.language).toBe('te');
    expect(guessLanguage({ name: 'Manjunath Gowda' })?.language).toBe('kn');
    expect(guessLanguage({ name: 'Anirban Chatterjee' })?.language).toBe('bn');
  });

  it('prefers the person the owner talks to at a shop', () => {
    expect(guessLanguage({ name: 'Green Park Society', contactPerson: 'Vinod Patil' })?.language).toBe('mr');
  });

  it('falls back to the place, but never guesses for Mumbai or the Hindi belt', () => {
    expect(guessLanguage({ name: 'Sharma Electricals', city: 'Coimbatore' })).toEqual({ language: 'ta', reason: 'place', because: 'Coimbatore' });
    expect(guessLanguage({ name: 'Sharma Electricals', city: 'Mumbai' })).toBeNull();
    expect(guessLanguage({ name: 'Sharma Electricals', stateCode: '27' })).toBeNull();
    expect(guessLanguage({ name: 'Sharma Electricals', stateCode: '09' })).toBeNull();
    expect(guessLanguage({ name: 'Sharma Electricals', stateCode: '33' })?.language).toBe('ta');
  });

  it('lets a name win over a place', () => {
    expect(guessLanguage({ name: 'Kirit Patel', city: 'Chennai' })?.language).toBe('gu');
  });

  it('says nothing when it has nothing to go on', () => {
    expect(guessLanguage({ name: 'Ravi Kumar' })).toBeNull();
    expect(guessLanguage({ name: 'Ravi Kumar', city: 'Delhi' })).toBeNull();
  });
});
