import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty } from "class-validator";

export class RequestEmailChangeDto {
  @ApiProperty({
    description: "New email address",
    example: "user@example.com",
  })
  @IsEmail()
  @IsNotEmpty()
  newEmail!: string;
}
