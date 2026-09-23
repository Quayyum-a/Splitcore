# Split Rule Sum Validator

## Overview

The `SplitRuleSumValidator` is a custom class-validator constraint that ensures split rule basis points always sum to exactly 10,000 (representing 100.00%).

## Purpose

Split rules in Splitcore define how revenue is distributed between:
- **Entertainer**: The performer/DJ receiving tips
- **Venue**: The physical location hosting the event
- **Platform**: Splitcore's platform fee

Using basis points (where 10,000 = 100%) prevents floating-point precision errors in financial calculations. The validator ensures these three shares always total exactly 10,000, preventing invalid revenue splits.

## Usage

### In a DTO

```typescript
import { IsInt, Min, Max, Validate } from 'class-validator';
import { SplitRuleSumValidator } from './validators/split-rule-sum.validator';

export class CreateSplitRuleDto {
  @IsInt()
  @Min(0)
  @Max(10000)
  entertainerBps!: number;

  @IsInt()
  @Min(0)
  @Max(10000)
  venueBps!: number;

  @IsInt()
  @Min(0)
  @Max(10000)
  platformBps!: number;

  // Phantom property for cross-field validation
  @Validate(SplitRuleSumValidator)
  _splitSum?: void;
}
```

### Example Requests

**Valid Request** (6500 + 2500 + 1000 = 10000):
```json
{
  "entertainerBps": 6500,
  "venueBps": 2500,
  "platformBps": 1000
}
```

**Invalid Request** (6500 + 2000 + 1000 = 9500):
```json
{
  "entertainerBps": 6500,
  "venueBps": 2000,
  "platformBps": 1000
}
```

**Error Response**:
```json
{
  "statusCode": 400,
  "message": [
    "Split rule basis points must sum to exactly 10000 (received 9500)"
  ],
  "error": "Bad Request"
}
```

## Implementation Details

### Decorator

The validator is decorated with `@ValidatorConstraint`:
- `name: 'splitRuleSum'` - Unique identifier for the constraint
- `async: false` - Synchronous validation (no database queries needed)

### Validation Logic

The `validate()` method:
1. Extracts `entertainerBps`, `venueBps`, and `platformBps` from the DTO object
2. Treats undefined/null values as 0
3. Returns `true` if sum === 10000, `false` otherwise

### Error Messages

The `defaultMessage()` method:
- Calculates the actual sum
- Returns a clear error message including the received sum
- Example: `"Split rule basis points must sum to exactly 10000 (received 9500)"`

## Test Coverage

The validator includes comprehensive unit tests covering:
- ✅ Valid sum (exactly 10000)
- ✅ Sum less than 10000
- ✅ Sum greater than 10000
- ✅ Zero values
- ✅ Undefined values
- ✅ Error message formatting

Run tests:
```bash
npm test -- split-rule-sum.validator.spec.ts
```

## Why Basis Points?

Basis points are industry standard for financial calculations:
- **Precision**: No floating-point rounding errors
- **Integer Math**: All operations use integers
- **Standard**: 1 basis point = 0.01%, 10000 = 100%

Examples:
- 6500 basis points = 65.00%
- 2500 basis points = 25.00%
- 1000 basis points = 10.00%
