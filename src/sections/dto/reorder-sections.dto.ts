import { ArrayMinSize, IsUUID } from 'class-validator';

export class ReorderSectionsDto {
  // Sibling section ids (same plan, same parent) in the desired order.
  // Server assigns priorityOrder 1..n by array position.
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  orderedSectionIds!: string[];
}
