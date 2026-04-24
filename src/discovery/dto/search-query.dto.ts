import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class SearchQueryDto {
  @ApiProperty({
    description: "Search query text",
    example: "lofi chill",
    maxLength: 120,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  q!: string;
}
