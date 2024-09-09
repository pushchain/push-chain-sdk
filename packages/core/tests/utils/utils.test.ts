import { getRandomElement } from '../../src/lib/utils';

describe('getRandomElement', () => {
  it('should return a valid element (Small Array ~ 1k elements)', () => {
    const testArray = Array.from(
      { length: 1000 },
      (_, i) => `https://validator/${i}`
    );
    const element = getRandomElement(testArray);
    expect(testArray).toContain(element);
  });

  it('should return a valid element (Large Array ~ 10k elements)', () => {
    const testArray = Array.from(
      { length: 10000 },
      (_, i) => `https://validator/${i}`
    );
    const element = getRandomElement(testArray);
    expect(testArray).toContain(element);
  });

  it('should return a valid element (Large Array ~ 100k elements)', () => {
    const testArray = Array.from(
      { length: 100000 },
      (_, i) => `https://validator/${i}`
    );
    const element = getRandomElement(testArray);
    expect(testArray).toContain(element);
  });

  it('should throw an error if array length is 0', () => {
    expect(() => getRandomElement([])).toThrow('Array cannot be empty');
  });
});
