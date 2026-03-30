import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsDateString, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class UpdateTrackMetadataDto {
  // TODO(Module 4): Keep fields optional for partial update behavior in implementation layer.
  @ApiPropertyOptional({ example: "New Title" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional({ example: "Pop" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  genre?: string;

  @ApiPropertyOptional({ type: [String], example: ["summer", "hit"] })
  // TODO(Module 4): Apply tag cleanup rules (trim/lowercase/unique) in service.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: "2026-03-01" })
  @IsOptional()
  @IsDateString()
  releaseDate?: string;
}
