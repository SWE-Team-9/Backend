import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateAppealDto {
  @ApiProperty({
    description: "Appeal message from the user",
    example: "I believe this report was made in error. Please review.",
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message!: string;
}
