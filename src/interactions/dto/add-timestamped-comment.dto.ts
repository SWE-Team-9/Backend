import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsString, MaxLength, Min, MinLength } from "class-validator";

export class AddTimestampedCommentDto {
  // TODO(Module 6): Add profanity/moderation hooks in service once moderation policy is finalized.
  @ApiProperty({ example: "This drop is amazing" })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text!: string;

  @ApiProperty({ example: 74, minimum: 0 })
  // TODO(Module 6): Validate timestampSeconds against track duration in service layer.
  @IsInt()
  @Min(0)
  timestampSeconds!: number;
}
