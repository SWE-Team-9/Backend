import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({
    description: 'Comment text content',
    maxLength: 2000,
    example: 'Great drop!',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content!: string;

  @ApiProperty({
    description: 'Timestamp in seconds within the track where the comment is anchored',
    minimum: 0,
    example: 42,
    type: Number,
  })
  @IsInt()
  @Min(0)
  timestampAt!: number;
}
