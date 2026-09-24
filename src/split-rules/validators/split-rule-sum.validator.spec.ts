import { ValidationArguments } from 'class-validator';
import { SplitRuleSumValidator } from './split-rule-sum.validator';

describe('SplitRuleSumValidator', () => {
  let validator: SplitRuleSumValidator;

  beforeEach(() => {
    validator = new SplitRuleSumValidator();
  });

  describe('validate', () => {
    it('should return true when basis points sum to exactly 10000', () => {
      const mockArgs: ValidationArguments = {
        object: {
          entertainerBps: 6500,
          venueBps: 2500,
          platformBps: 1000,
        },
        value: undefined,
        constraints: [],
        targetName: 'CreateSplitRuleDto',
        property: '_splitSum',
      };

      const result = validator.validate(undefined, mockArgs);

      expect(result).toBe(true);
    });

    it('should return false when basis points sum is less than 10000', () => {
      const mockArgs: ValidationArguments = {
        object: {
          entertainerBps: 6500,
          venueBps: 2000,
          platformBps: 1000,
        },
        value: undefined,
        constraints: [],
        targetName: 'CreateSplitRuleDto',
        property: '_splitSum',
      };

      const result = validator.validate(undefined, mockArgs);

      expect(result).toBe(false);
    });

    it('should return false when basis points sum is greater than 10000', () => {
      const mockArgs: ValidationArguments = {
        object: {
          entertainerBps: 7000,
          venueBps: 2500,
          platformBps: 1000,
        },
        value: undefined,
        constraints: [],
        targetName: 'CreateSplitRuleDto',
        property: '_splitSum',
      };

      const result = validator.validate(undefined, mockArgs);

      expect(result).toBe(false);
    });

    it('should handle zero values correctly', () => {
      const mockArgs: ValidationArguments = {
        object: {
          entertainerBps: 10000,
          venueBps: 0,
          platformBps: 0,
        },
        value: undefined,
        constraints: [],
        targetName: 'CreateSplitRuleDto',
        property: '_splitSum',
      };

      const result = validator.validate(undefined, mockArgs);

      expect(result).toBe(true);
    });

    it('should handle undefined basis points as zero', () => {
      const mockArgs: ValidationArguments = {
        object: {
          entertainerBps: 10000,
          venueBps: undefined,
          platformBps: undefined,
        },
        value: undefined,
        constraints: [],
        targetName: 'CreateSplitRuleDto',
        property: '_splitSum',
      };

      const result = validator.validate(undefined, mockArgs);

      expect(result).toBe(true);
    });

    it('should return false when all basis points are undefined', () => {
      const mockArgs: ValidationArguments = {
        object: {
          entertainerBps: undefined,
          venueBps: undefined,
          platformBps: undefined,
        },
        value: undefined,
        constraints: [],
        targetName: 'CreateSplitRuleDto',
        property: '_splitSum',
      };

      const result = validator.validate(undefined, mockArgs);

      expect(result).toBe(false);
    });
  });

  describe('defaultMessage', () => {
    it('should return error message with actual sum when sum is less than 10000', () => {
      const mockArgs: ValidationArguments = {
        object: {
          entertainerBps: 6500,
          venueBps: 2000,
          platformBps: 1000,
        },
        value: undefined,
        constraints: [],
        targetName: 'CreateSplitRuleDto',
        property: '_splitSum',
      };

      const message = validator.defaultMessage(mockArgs);

      expect(message).toBe('Split rule basis points must sum to exactly 10000 (received 9500)');
    });

    it('should return error message with actual sum when sum is greater than 10000', () => {
      const mockArgs: ValidationArguments = {
        object: {
          entertainerBps: 7000,
          venueBps: 2500,
          platformBps: 1000,
        },
        value: undefined,
        constraints: [],
        targetName: 'CreateSplitRuleDto',
        property: '_splitSum',
      };

      const message = validator.defaultMessage(mockArgs);

      expect(message).toBe('Split rule basis points must sum to exactly 10000 (received 10500)');
    });

    it('should handle undefined values in error message', () => {
      const mockArgs: ValidationArguments = {
        object: {
          entertainerBps: undefined,
          venueBps: undefined,
          platformBps: undefined,
        },
        value: undefined,
        constraints: [],
        targetName: 'CreateSplitRuleDto',
        property: '_splitSum',
      };

      const message = validator.defaultMessage(mockArgs);

      expect(message).toBe('Split rule basis points must sum to exactly 10000 (received 0)');
    });

    it('should include correct sum in message when validation passes', () => {
      const mockArgs: ValidationArguments = {
        object: {
          entertainerBps: 6500,
          venueBps: 2500,
          platformBps: 1000,
        },
        value: undefined,
        constraints: [],
        targetName: 'CreateSplitRuleDto',
        property: '_splitSum',
      };

      const message = validator.defaultMessage(mockArgs);

      expect(message).toBe('Split rule basis points must sum to exactly 10000 (received 10000)');
    });
  });
});
