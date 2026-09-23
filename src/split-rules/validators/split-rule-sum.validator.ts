import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

/**
 * Custom validator to ensure split rule basis points sum to exactly 10000.
 * Validates that entertainerBps + venueBps + platformBps === 10000.
 *
 * Usage:
 * ```typescript
 * class CreateSplitRuleDto {
 *   @IsInt() entertainerBps!: number;
 *   @IsInt() venueBps!: number;
 *   @IsInt() platformBps!: number;
 *
 *   @Validate(SplitRuleSumValidator)
 *   _splitSum?: void;
 * }
 * ```
 */
@ValidatorConstraint({ name: 'splitRuleSum', async: false })
export class SplitRuleSumValidator implements ValidatorConstraintInterface {
  /**
   * Validates that the sum of entertainerBps, venueBps, and platformBps equals exactly 10000.
   *
   * @param value - The value being validated (typically undefined for phantom properties)
   * @param args - Validation arguments containing the object being validated
   * @returns true if sum === 10000, false otherwise
   */
  validate(value: any, args: ValidationArguments): boolean {
    const obj = args.object as any;

    // Extract the three basis point fields
    const entertainerBps = obj.entertainerBps ?? 0;
    const venueBps = obj.venueBps ?? 0;
    const platformBps = obj.platformBps ?? 0;

    // Validate sum equals exactly 10000 (100.00%)
    const sum = entertainerBps + venueBps + platformBps;
    return sum === 10000;
  }

  /**
   * Returns a clear error message including the actual sum when validation fails.
   *
   * @param args - Validation arguments containing the object being validated
   * @returns Error message with the actual sum value
   */
  defaultMessage(args: ValidationArguments): string {
    const obj = args.object as any;

    const entertainerBps = obj.entertainerBps ?? 0;
    const venueBps = obj.venueBps ?? 0;
    const platformBps = obj.platformBps ?? 0;

    const sum = entertainerBps + venueBps + platformBps;

    return `Split rule basis points must sum to exactly 10000 (received ${sum})`;
  }
}
