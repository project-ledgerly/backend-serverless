import { IsNumberString } from 'class-validator';

/** What the account really holds right now, e.g. "12500.50". */
export class SetBalanceDto {
  @IsNumberString()
  balance!: string;
}
