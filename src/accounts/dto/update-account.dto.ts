import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Deliberately no `type` or `balance` here. Type-matching against linked
// Sections would need re-validation if type changed, and balance is
// derived from Transactions, not editable directly — only rename is safe.
export class UpdateAccountDto {
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  name?: string;
}
