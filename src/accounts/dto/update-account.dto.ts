import { IsNotEmpty, IsNumberString, IsOptional, IsString } from 'class-validator';

// Deliberately no `type` or `balance` here. Type-matching against linked
// Sections would need re-validation if type changed, and balance is
// derived from Transactions, not set directly. What *is* editable is the
// starting balance: balance = startingBalance + every Transaction and
// income receipt since, so changing it shifts the balance by the same
// amount and leaves the history intact.
export class UpdateAccountDto {
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumberString()
  startingBalance?: string;
}
