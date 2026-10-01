import { IsIn } from 'class-validator';

// A deliberate extra step so this can never fire from a stray request.
export class ResetUserDto {
  @IsIn(['RESET'])
  confirm!: 'RESET';
}
