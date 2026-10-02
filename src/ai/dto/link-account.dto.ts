import { IsString, Matches } from 'class-validator';

export class LinkAccountDto {
  // The account number as the bank prints it, or its last 4 to 8 digits.
  // Spaces and dashes are ignored.
  @IsString()
  @Matches(/^[A-Za-z0-9 -]{4,40}$/, { message: 'identifier must be 4 to 40 letters, digits, spaces or dashes' })
  identifier!: string;
}
