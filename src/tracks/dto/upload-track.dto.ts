import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsDateString, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class UploadTrackDto {
  // TODO(Module 4): Add stricter title normalization rules when product naming policy is finalized.
  @ApiProperty({
    example: "Ya Ana",
    description: "Track title.",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title!: string;

  @ApiProperty({
    example: "Pop",
    description: "Track genre label.",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  genre!: string;

  @ApiPropertyOptional({
    type: [String],
    example: ["pop", "arabic"],
    description: "Track tags.",
  })
  // TODO(Module 4): Validate max tags count and deduplicate tags in service implementation.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    example: "2026-03-01",
    description: "Release date in ISO format.",
  })
  @IsOptional()
  @IsDateString()
  releaseDate?: string;
}
