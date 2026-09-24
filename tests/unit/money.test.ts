import { describe, expect, it } from 'vitest';

import {
  amountInWords,
  applyBasisPoints,
  divRound,
  formatMoneyIndian,
  lineGross,
  MoneyError,
  parseMoney,
  parsePercent,
  parseQuantity,
  roundToRupee,
  taxableFromInclusive,
} from '@/lib/money';

describe('parsing', () => {
  it('parses rupee strings exactly, including grouping separators', () => {
    expect(parseMoney('1,234.50')).toBe(123450);
    expect(parseMoney('0.01')).toBe(1);
    expect(parseMoney('800')).toBe(80000);
    expect(parseMoney(' 2,05,000.00 ')).toBe(20500000);
  });

  it('rounds half-up when the input carries more precision than we store', () => {
    expect(parseMoney('10.005')).toBe(1001);
    expect(parseMoney('10.004')).toBe(1000);
  });

  it('rejects junk rather than coercing it to a number', () => {
    expect(() => parseMoney('abc')).toThrow(MoneyError);
    expect(() => parseMoney('')).toThrow(MoneyError);
    expect(() => parseMoney('1.2.3')).toThrow(MoneyError);
  });

  it('keeps three decimals of quantity', () => {
    expect(parseQuantity('2.5')).toBe(2500);
    expect(parseQuantity('0.125')).toBe(125);
  });

  it('keeps percentages in basis points', () => {
    expect(parsePercent('18')).toBe(1800);
    expect(parsePercent('2.5')).toBe(250);
    expect(parsePercent('0.1')).toBe(10);
  });
});

describe('arithmetic', () => {
  it('avoids the classic float drift', () => {
    // 0.1 + 0.2 !== 0.3 in floating point; in paise it is exact.
    expect(parseMoney('0.1') + parseMoney('0.2')).toBe(parseMoney('0.3'));
  });

  it('rounds half away from zero', () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(-5, 2)).toBe(-3);
    expect(divRound(4, 2)).toBe(2);
    expect(divRound(1, 3)).toBe(0);
    expect(divRound(2, 3)).toBe(1);
  });

  it('computes line amounts from milli-unit quantities', () => {
    expect(lineGross(parseQuantity('2'), parseMoney('800'))).toBe(160000);
    expect(lineGross(parseQuantity('1.5'), parseMoney('333.33'))).toBe(50000); // 499.995 -> 500.00
  });

  it('applies basis-point rates', () => {
    expect(applyBasisPoints(205000, 1800)).toBe(36900);
    expect(applyBasisPoints(100, 250)).toBe(3); // 2.5 paise -> 3
  });

  it('backs tax out of an inclusive price', () => {
    expect(taxableFromInclusive(118000, 1800)).toBe(100000);
    expect(taxableFromInclusive(105000, 500)).toBe(100000);
  });

  it('rounds a total to the nearest rupee', () => {
    expect(roundToRupee(241949)).toBe(241900);
    expect(roundToRupee(241950)).toBe(242000);
  });
});

describe('formatting', () => {
  it('groups digits the Indian way', () => {
    expect(formatMoneyIndian(24190000, { withSymbol: true })).toBe('₹2,41,900.00');
    expect(formatMoneyIndian(100000)).toBe('1,000.00');
    expect(formatMoneyIndian(1234567890)).toBe('1,23,45,678.90');
  });

  it('writes amounts in words for the invoice footer', () => {
    expect(amountInWords(205000)).toBe('Two Thousand Fifty Rupees Only');
    expect(amountInWords(241900)).toBe('Two Thousand Four Hundred Nineteen Rupees Only');
    expect(amountInWords(50)).toBe('Fifty Paise Only');
    expect(amountInWords(1000000000)).toBe('One Crore Rupees Only'); // 1,00,00,000 rupees
    expect(amountInWords(12345678)).toBe('One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees and Seventy Eight Paise Only');
  });
});
