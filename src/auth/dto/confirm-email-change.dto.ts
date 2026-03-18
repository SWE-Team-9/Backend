import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty } from "class-validator";

export class ConfirmEmailChangeDto {
  @ApiProperty({
    description: "Email change verification token",
    example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
