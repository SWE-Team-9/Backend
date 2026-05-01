import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignReportDto {
  @ApiProperty({
    description: 'Admin user ID to assign this report to',
    example: '4d2f5dd5-f6dd-44fb-bddb-53eb95ef2d34',
  })
  @IsUUID('4')
  adminId!: string;
}
